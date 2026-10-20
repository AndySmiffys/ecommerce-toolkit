# Promotion Engine on AWS

Test and live run in one AWS account in London (`eu-west-2`): one shared network, then one stack per environment. The app runs on AWS App Runner from an image built inside AWS (CodeBuild), with a private PostgreSQL database on Amazon RDS. Everything is created by `aws.mjs`, which shows what it will do first and only acts with `--execute`.

```
node infra/aws/aws.mjs network [--execute]
node infra/aws/aws.mjs environment <test|live> [--execute]
node infra/aws/aws.mjs secret <test|live>
node infra/aws/aws.mjs build <test|live>
node infra/aws/aws.mjs release <test|live> <image-tag> [--execute]
node infra/aws/aws.mjs domain <test|live> [--execute]
node infra/aws/aws.mjs status <test|live>
node infra/aws/aws.mjs destroy test --execute
```

Sign in with `aws login --region eu-west-2` (an IAM user, never root) before using it. Open a new terminal after installing the AWS CLI.

## What is created

| Part | Test | Live | Notes |
|---|---|---|---|
| Network (shared) | yes | yes | One VPC, private and public subnets, **one NAT gateway** (the main fixed cost, roughly £30 to £35 a month plus data). |
| Database | `db.t4g.micro`, 1 day backups | `db.t4g.small`, 7 day backups, deletion protection | PostgreSQL 17, private, encrypted. A final snapshot is kept if a stack is deleted. Turn on `DbMultiAz` for live when you want automatic failover (doubles the database cost). |
| App Runner | 1 to 2 instances | 1 to 3 instances | 1 vCPU, 2 GB. Starts only once an image is released. |
| Secrets Manager | database login, Shopify client secret | same | The Shopify secret is typed into `aws.mjs secret` (hidden) and never written to a file or template. |
| Image build | CodeBuild + ECR | same | Builds the committed code (a zip of `git HEAD`), so uncommitted changes are not included. |

The addresses are `shopifyapps-test.smiffys.com` and `shopifyapps.smiffys.com` (DNS in Route 53, same account). See `test.json` and `live.json` for every setting.

## Setting up an environment, in order

1. `network --execute` (once).
2. Create the environment's Shopify app, then set its client ID in `<env>.json` (`ShopifyApiKey`). Test needs its own Shopify app. Live uses the existing app.
3. `environment <env> --execute` (the database takes about 10 minutes).
4. `secret <env>` and type the app's client secret.
5. `build <env>`, which prints an image tag.
6. `release <env> <tag> --execute` creates the App Runner service. The first start applies the database migrations.
7. `domain <env> --execute` links the address, requests the HTTPS certificate and adds the DNS records.
8. Update that Shopify app's URLs to the address and deploy its configuration (`shopify app deploy --config <name>`), then install it.

To release new code later: commit, `build <env>`, then `release <env> <tag> --execute`.

## Things to know

- The app's settings reach it as environment variables: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, and the database login (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`). `docker-start.sh` joins the database settings into `DATABASE_URL`, applies pending migrations, then starts the app.
- A Shopify config that is deployed with `include_config_on_deploy = true` pushes its `application_url`, `redirect_urls` and `app_proxy` to Shopify. Set them to the real address first. `https://example.com` is only a placeholder.
- `destroy` only works on test. Live is protected on purpose.
- Costs are estimates. Check AWS's pricing pages.
