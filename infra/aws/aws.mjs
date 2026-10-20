#!/usr/bin/env node
// eCommerce Toolkit on AWS: creates and updates the network, the test and live environments, builds the app image in
// AWS and releases it. It only uses the AWS command line (`aws`) and Node's own modules.
//
//   node infra/aws/aws.mjs network [--execute]       shared network (once)
//   node infra/aws/aws.mjs environment <test|live> [--execute]
//   node infra/aws/aws.mjs secret <test|live> [--clipboard]   the Shopify client secret (typed hidden, or from the clipboard), stored in Secrets Manager
//   node infra/aws/aws.mjs build <test|live>         zip the committed code, build the image in AWS, print its tag
//   node infra/aws/aws.mjs release <test|live> <tag> [--execute]   run that image (creates or updates the App Runner service)
//   node infra/aws/aws.mjs domain <test|live> [--execute]          custom domain, certificate and DNS records
//   node infra/aws/aws.mjs status <test|live>
//   node infra/aws/aws.mjs destroy test --execute    delete the test environment (a database snapshot is kept)
//
// Anything that creates, changes or deletes something shows what it would do first and only does it with --execute.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-west-2";
const networkStack = "ecommerce-toolkit-network";
const stackName = environment => `ecommerce-toolkit-${environment}`;

// ---- running the AWS command line ----
function findAws() {
  const candidates = [process.env.AWS_CLI_PATH, "aws", join(process.env.LOCALAPPDATA ?? homedir(), "Programs", "Amazon", "AWSCLIV2", "aws.exe"), "C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe"].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error("The AWS command line was not found. Install it (winget install -e --id Amazon.AWSCLI) and open a new terminal.");
}
const awsPath = findAws();
function aws(args, { json = true, allowFail = false } = {}) {
  const result = spawnSync(awsPath, [...args, "--region", region, ...(json ? ["--output", "json"] : [])], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    if (allowFail) return null;
    throw new Error(`aws ${args.slice(0, 2).join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const text = result.stdout.trim();
  if (!json || !text) return text;
  try { return JSON.parse(text); } catch { return text; }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const say = (...parts) => console.log(...parts);

// ---- settings for each environment ----
// With `allowPending`, a value still to be filled in becomes "pending". The database, secrets and image build can be
// created before the Shopify app exists; releasing the app (which needs the real value) is blocked until it is set.
function environmentSettings(environment, { allowPending = false } = {}) {
  if (!["test", "live"].includes(environment)) throw new Error('Say which environment: "test" or "live".');
  const settings = JSON.parse(readFileSync(join(here, `${environment}.json`), "utf8"));
  const unset = Object.entries(settings).filter(([, value]) => /REPLACE/i.test(String(value))).map(([key]) => key);
  if (unset.length && !allowPending) throw new Error(`Set ${unset.join(", ")} in infra/aws/${environment}.json first.`);
  for (const key of unset) { settings[key] = "pending"; say(`Note: ${key} is not set yet, so "pending" is used until it is.`); }
  return settings;
}

// ---- CloudFormation: show the changes, and make them only with --execute ----
function stackStatus(name) {
  const result = aws(["cloudformation", "describe-stacks", "--stack-name", name], { allowFail: true });
  return result?.Stacks?.[0] ?? null;
}
const stackOutputs = stack => Object.fromEntries((stack?.Outputs ?? []).map(output => [output.OutputKey, output.OutputValue]));

async function applyStack(name, templateFile, parameters, execute, { capabilities = true } = {}) {
  const existing = stackStatus(name);
  const exists = existing && existing.StackStatus !== "REVIEW_IN_PROGRESS";
  const changeSet = `change-${Date.now()}`;
  const directory = mkdtempSync(join(tmpdir(), "ecommerce-toolkit-aws-"));
  try {
    const file = join(directory, "parameters.json");
    writeFileSync(file, JSON.stringify(parameters.map(([key, value]) => value === undefined ? { ParameterKey: key, UsePreviousValue: true } : { ParameterKey: key, ParameterValue: String(value) })));
    aws(["cloudformation", "create-change-set", "--stack-name", name, "--change-set-name", changeSet, "--change-set-type", exists ? "UPDATE" : "CREATE",
      "--template-body", `file://${join(here, templateFile)}`, "--parameters", `file://${file}`, ...(capabilities ? ["--capabilities", "CAPABILITY_IAM"] : []),
      "--tags", "Key=Project,Value=ecommerce-toolkit"]);
    let described;
    for (let attempt = 0; attempt < 60; attempt++) {
      described = aws(["cloudformation", "describe-change-set", "--stack-name", name, "--change-set-name", changeSet]);
      if (["CREATE_COMPLETE", "FAILED"].includes(described.Status)) break;
      await sleep(2000);
    }
    if (described.Status === "FAILED") {
      aws(["cloudformation", "delete-change-set", "--stack-name", name, "--change-set-name", changeSet], { allowFail: true });
      if (/didn't contain changes|No updates/i.test(described.StatusReason ?? "")) { say(`${name}: already up to date, nothing to change.`); return stackStatus(name); }
      throw new Error(`${name}: the change could not be prepared: ${described.StatusReason}`);
    }
    say(`\n${name}: ${exists ? "these changes would be made" : "these resources would be created"}:`);
    for (const change of described.Changes) {
      const item = change.ResourceChange;
      say(`  ${item.Action.padEnd(7)} ${item.ResourceType.padEnd(36)} ${item.LogicalResourceId}${item.Replacement === "True" ? "  (replaced)" : ""}`);
    }
    if (!execute) {
      aws(["cloudformation", "delete-change-set", "--stack-name", name, "--change-set-name", changeSet], { allowFail: true });
      if (!exists) aws(["cloudformation", "delete-stack", "--stack-name", name], { allowFail: true, json: false });
      say("\nNothing was changed. Run again with --execute to make these changes.");
      return null;
    }
    aws(["cloudformation", "execute-change-set", "--stack-name", name, "--change-set-name", changeSet], { json: false });
    say("\nWorking. This can take several minutes (a database takes about 10).");
    let last = "";
    for (;;) {
      await sleep(15000);
      const stack = stackStatus(name);
      if (!stack) throw new Error(`${name} disappeared.`);
      if (stack.StackStatus !== last) { say(`  ${new Date().toLocaleTimeString()}  ${stack.StackStatus}`); last = stack.StackStatus; }
      if (/_COMPLETE$/.test(stack.StackStatus) && !/CLEANUP/.test(stack.StackStatus) || /ROLLBACK|FAILED/.test(stack.StackStatus)) {
        if (/ROLLBACK|FAILED/.test(stack.StackStatus)) {
          const events = aws(["cloudformation", "describe-stack-events", "--stack-name", name, "--max-items", "40"]).StackEvents.filter(event => /FAILED/.test(event.ResourceStatus ?? ""));
          throw new Error(`${name} failed (${stack.StackStatus}):\n` + events.slice(0, 5).map(event => `  ${event.LogicalResourceId}: ${event.ResourceStatusReason}`).join("\n"));
        }
        say(`${name}: done.`);
        return stack;
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function environmentParameters(environment, settings, imageTag) {
  return [
    ["Environment", environment], ["NetworkStackName", networkStack], ["DomainName", settings.DomainName], ["ShopifyApiKey", settings.ShopifyApiKey], ["Scopes", settings.Scopes],
    ["DbInstanceClass", settings.DbInstanceClass], ["DbStorageGb", settings.DbStorageGb], ["DbMultiAz", settings.DbMultiAz], ["DbBackupDays", settings.DbBackupDays],
    ["MinInstances", settings.MinInstances], ["MaxInstances", settings.MaxInstances], ["ImageTag", imageTag],
  ];
}
// Keep the image that is running when an environment is updated for another reason.
const currentImageTag = environment => stackStatus(stackName(environment))?.Parameters?.find(parameter => parameter.ParameterKey === "ImageTag")?.ParameterValue ?? "none";

// ---- hidden typing, for the Shopify secret ----
function askHidden(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    const input = process.stdin;
    input.setRawMode?.(true);
    input.resume();
    input.setEncoding("utf8");
    let value = "";
    const onData = chunk => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") { input.setRawMode?.(false); input.pause(); input.off("data", onData); process.stdout.write("\n"); resolve(value); return; }
        if (character === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    };
    input.on("data", onData);
  });
}

// ---- commands ----
const [command, environment, extra] = process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const execute = process.argv.includes("--execute");

async function main() {
  const identity = aws(["sts", "get-caller-identity"]);
  say(`AWS account ${identity.Account} as ${identity.Arn.split("/").pop()}, region ${region}.`);

  if (command === "network") {
    await applyStack(networkStack, "network.yaml", [["VpcCidr", "10.20.0.0/16"]], execute);
  } else if (command === "environment") {
    const settings = environmentSettings(environment, { allowPending: !currentImageTag(environment) || currentImageTag(environment) === "none" });
    if (!stackStatus(networkStack)) throw new Error("Create the network first: node infra/aws/aws.mjs network --execute");
    await applyStack(stackName(environment), "environment.yaml", environmentParameters(environment, settings, currentImageTag(environment)), execute);
  } else if (command === "secret") {
    const stack = stackStatus(stackName(environment));
    if (!stack) throw new Error(`Create the ${environment} environment first.`);
    // --clipboard reads the secret from the clipboard (copy it first), which avoids pasting into a hidden prompt, and
    // empties the clipboard afterwards. Only its length and first letters are shown, never the secret itself.
    const fromClipboard = process.argv.includes("--clipboard");
    const secret = (fromClipboard
      ? spawnSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" }).stdout ?? ""
      : await askHidden(`Shopify client secret for the ${environment} app (typing is hidden): `)).trim();
    say(`Received ${secret.length} characters${secret ? `, starting "${secret.slice(0, 6)}"` : ""}.`);
    if (secret.length < 16 || /\s/.test(secret)) throw new Error(`That does not look like a Shopify client secret (it has ${secret.length} characters${/\s/.test(secret) ? " and contains spaces" : ""}). Copy the Client secret from the app's Settings in the Dev Dashboard, then run: node infra/aws/aws.mjs secret ${environment} --clipboard`);
    const directory = mkdtempSync(join(tmpdir(), "ecommerce-toolkit-secret-"));
    try {
      const file = join(directory, "secret.json");
      writeFileSync(file, JSON.stringify({ SecretId: stackOutputs(stack).ShopifySecretArn, SecretString: secret }), { mode: 0o600 });
      aws(["secretsmanager", "put-secret-value", "--cli-input-json", `file://${file}`], { json: false });
    } finally { rmSync(directory, { recursive: true, force: true }); }
    if (fromClipboard) spawnSync("powershell", ["-NoProfile", "-Command", "Set-Clipboard -Value $null"]);
    say("Stored in AWS Secrets Manager. It is not written anywhere else." + (fromClipboard ? " The clipboard has been emptied." : ""));
  } else if (command === "build") {
    const outputs = stackOutputs(stackStatus(stackName(environment)));
    if (!outputs.SourceBucket) throw new Error(`Create the ${environment} environment first.`);
    const git = args => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (git(["status", "--porcelain"]).stdout.trim()) say("Note: only committed code is built. Uncommitted changes are not included.");
    const tag = `${git(["rev-parse", "--short", "HEAD"]).stdout.trim()}-${Date.now().toString(36)}`;
    const directory = mkdtempSync(join(tmpdir(), "ecommerce-toolkit-source-"));
    try {
      const zip = join(directory, "source.zip");
      if (git(["archive", "--format=zip", "-o", zip, "HEAD"]).status !== 0) throw new Error("Could not zip the code.");
      say(`Uploading the code (${tag})...`);
      aws(["s3", "cp", zip, `s3://${outputs.SourceBucket}/source.zip`, "--only-show-errors"], { json: false });
    } finally { rmSync(directory, { recursive: true, force: true }); }
    const started = aws(["codebuild", "start-build", "--project-name", outputs.BuildProject, "--environment-variables-override", `name=IMAGE_TAG,value=${tag},type=PLAINTEXT`]);
    const id = started.build.id;
    say("Building the image in AWS. This takes a few minutes.");
    let phase = "";
    for (;;) {
      await sleep(10000);
      const build = aws(["codebuild", "batch-get-builds", "--ids", id]).builds[0];
      if (build.currentPhase !== phase) { phase = build.currentPhase; say(`  ${new Date().toLocaleTimeString()}  ${phase}`); }
      if (build.buildStatus !== "IN_PROGRESS") {
        if (build.buildStatus !== "SUCCEEDED") {
          const messages = build.phases.flatMap(item => (item.contexts ?? []).map(context => context.message)).filter(Boolean);
          let log = "";
          if (build.logs?.groupName && build.logs?.streamName) {
            const events = aws(["logs", "get-log-events", "--log-group-name", build.logs.groupName, "--log-stream-name", build.logs.streamName, "--limit", "60", "--no-start-from-head"], { allowFail: true });
            log = (events?.events ?? []).map(event => event.message.trimEnd()).join("\n");
          }
          throw new Error(`The build ${build.buildStatus}. ${messages.join(" ")}\n${log}`);
        }
        say(`\nBuilt image tag: ${tag}\nRun it with: node infra/aws/aws.mjs release ${environment} ${tag} --execute`);
        break;
      }
    }
  } else if (command === "release") {
    const tag = extra;
    const settings = environmentSettings(environment);
    const outputs = stackOutputs(stackStatus(stackName(environment)));
    if (!tag) throw new Error("Say which image: release <test|live> <tag>");
    const image = aws(["ecr", "describe-images", "--repository-name", `ecommerce-toolkit-${environment}`, "--image-ids", `imageTag=${tag}`], { allowFail: true });
    if (!image) throw new Error(`There is no image tagged ${tag} for ${environment}. Build one first.`);
    if (!outputs.BuildProject) throw new Error(`Create the ${environment} environment first.`);
    const secret = aws(["secretsmanager", "get-secret-value", "--secret-id", outputs.ShopifySecretArn], { allowFail: true });
    if (!secret) throw new Error(`The Shopify client secret is not stored yet. Run: node infra/aws/aws.mjs secret ${environment}`);
    await applyStack(stackName(environment), "environment.yaml", environmentParameters(environment, settings, tag), execute);
  } else if (command === "domain") {
    const settings = environmentSettings(environment);
    const outputs = stackOutputs(stackStatus(stackName(environment)));
    if (!outputs.ServiceArn) throw new Error(`The ${environment} service is not running yet. Release an image first.`);
    const zones = aws(["route53", "list-hosted-zones"]).HostedZones.filter(zone => (settings.DomainName + ".").endsWith("." + zone.Name) || settings.DomainName + "." === zone.Name);
    if (!zones.length) throw new Error(`No Route 53 hosted zone found for ${settings.DomainName}.`);
    const zone = zones.sort((a, b) => b.Name.length - a.Name.length)[0];
    const zoneId = zone.Id.split("/").pop();
    const domains = aws(["apprunner", "describe-custom-domains", "--service-arn", outputs.ServiceArn]);
    const associated = domains.CustomDomains.find(domain => domain.DomainName === settings.DomainName);
    say(`Domain ${settings.DomainName} in Route 53 zone ${zone.Name}: ${associated ? "already linked to the service (" + associated.Status + ")" : "not linked yet"}.`);
    if (!execute) { say("\nNothing was changed. Run again with --execute to link the domain, request its HTTPS certificate and add the DNS records."); return; }
    if (!associated) aws(["apprunner", "associate-custom-domain", "--service-arn", outputs.ServiceArn, "--domain-name", settings.DomainName, "--no-enable-www-subdomain"]);
    // AWS takes a moment to produce the certificate-check records after the domain is linked, so wait for them.
    let target = domains.DNSTarget;
    let validation = [];
    for (let attempt = 0; attempt < 24; attempt++) {
      const state = aws(["apprunner", "describe-custom-domains", "--service-arn", outputs.ServiceArn]);
      const current = state.CustomDomains.find(domain => domain.DomainName === settings.DomainName);
      target = state.DNSTarget;
      validation = current?.CertificateValidationRecords ?? [];
      if (validation.length || current?.Status === "active") break;
      await sleep(5000);
    }
    const records = [{ Name: settings.DomainName, Value: target }, ...validation.map(record => ({ Name: record.Name, Value: record.Value }))];
    const directory = mkdtempSync(join(tmpdir(), "ecommerce-toolkit-dns-"));
    try {
      const file = join(directory, "records.json");
      writeFileSync(file, JSON.stringify({ Comment: "eCommerce Toolkit", Changes: records.map(record => ({ Action: "UPSERT", ResourceRecordSet: { Name: record.Name, Type: "CNAME", TTL: 300, ResourceRecords: [{ Value: record.Value }] } })) }));
      aws(["route53", "change-resource-record-sets", "--hosted-zone-id", zoneId, "--change-batch", `file://${file}`]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
    say(`Added ${records.length} DNS records. Waiting for the certificate (this can take 10 minutes or more)...`);
    for (let attempt = 0; attempt < 120; attempt++) {
      const state = aws(["apprunner", "describe-custom-domains", "--service-arn", outputs.ServiceArn]).CustomDomains.find(domain => domain.DomainName === settings.DomainName);
      if (attempt % 6 === 0) say(`  ${new Date().toLocaleTimeString()}  ${state?.Status}`);
      if (state?.Status === "active") { say(`\nLive at https://${settings.DomainName}`); return; }
      if (/FAILED/i.test(state?.Status ?? "")) throw new Error(`The domain check failed (${state.Status}).`);
      await sleep(10000);
    }
    say("Still waiting. Check again later with: node infra/aws/aws.mjs status " + environment);
  } else if (command === "status") {
    const stack = stackStatus(stackName(environment));
    if (!stack) { say(`The ${environment} environment does not exist yet.`); return; }
    const outputs = stackOutputs(stack);
    say(`${stackName(environment)}: ${stack.StackStatus}`);
    for (const [key, value] of Object.entries(outputs)) say(`  ${key}: ${value}`);
    const database = aws(["rds", "describe-db-instances", "--db-instance-identifier", `ecommerce-toolkit-${environment}`], { allowFail: true });
    if (database) say(`  Database: ${database.DBInstances[0].DBInstanceStatus} (${database.DBInstances[0].DBInstanceClass})`);
    if (outputs.ServiceArn) {
      const service = aws(["apprunner", "describe-service", "--service-arn", outputs.ServiceArn]).Service;
      say(`  App Runner: ${service.Status}, image ${service.SourceConfiguration.ImageRepository.ImageIdentifier.split(":").pop()}`);
      for (const domain of aws(["apprunner", "describe-custom-domains", "--service-arn", outputs.ServiceArn]).CustomDomains) say(`  Domain ${domain.DomainName}: ${domain.Status}`);
      say(`  Default address: https://${outputs.ServiceUrl}`);
    }
  } else if (command === "destroy") {
    if (environment !== "test") throw new Error("Only the test environment can be deleted from here. Live is protected: delete it by hand if you ever need to.");
    const stack = stackStatus(stackName("test"));
    if (!stack) { say("The test environment does not exist."); return; }
    say("This deletes the test environment: the app service, its database (a final snapshot is kept) and its secrets.");
    if (!execute) { say("Nothing was deleted. Run again with --execute to delete it."); return; }
    const outputs = stackOutputs(stack);
    if (outputs.ServiceArn) for (const domain of aws(["apprunner", "describe-custom-domains", "--service-arn", outputs.ServiceArn]).CustomDomains) aws(["apprunner", "disassociate-custom-domain", "--service-arn", outputs.ServiceArn, "--domain-name", domain.DomainName], { allowFail: true });
    if (outputs.SourceBucket) aws(["s3", "rm", `s3://${outputs.SourceBucket}`, "--recursive", "--only-show-errors"], { json: false, allowFail: true });
    aws(["cloudformation", "delete-stack", "--stack-name", stackName("test")], { json: false });
    say("Deleting. Check progress with: node infra/aws/aws.mjs status test");
  } else {
    say("Commands: network | environment | secret | build | release | domain | status | destroy. See the top of this file.");
  }
}

main().catch(error => { console.error("\n" + (error instanceof Error ? error.message : error)); process.exit(1); });
