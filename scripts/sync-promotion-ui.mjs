import { copyFile } from "node:fs/promises";
const source = new URL("../app/modules/promotions/design/promotion-ui.js", import.meta.url);
const asset = new URL("../extensions/promotion-engine/assets/promotion-ui.js", import.meta.url);
await copyFile(source, asset);
