"use strict";
// CPSY 300 Team Project, Phase 2 — GIVEN CODE. Copy this file into your repository exactly where the starter
// zip puts it. You may change it, but explain any change in your report.
Object.defineProperty(exports, "__esModule", { value: true });
exports.processCsv = processCsv;
// Runs once for each CSV uploaded to the "uploads" container.
// Trigger: an Event Grid event "Blob Created" — the only kind of blob trigger Flex Consumption supports.
// It cleans the file, works out the insights, and stores both in Cosmos DB, so that every page view
// afterwards is a cheap database read instead of a fresh calculation.
const functions_1 = require("@azure/functions");
const clean_1 = require("../lib/clean");
const store_1 = require("../lib/store");
async function processCsv(blob, context) {
    const name = String(context.triggerMetadata?.name ?? "unknown");
    const started = Date.now();
    if (!name.toLowerCase().endsWith(".csv")) {
        context.log(`skipped blob=${name} reason=not-a-csv`);
        return;
    }
    const text = Buffer.isBuffer(blob) ? blob.toString("utf8") : String(blob);
    const { recipes, insights } = (0, clean_1.analyseCsv)(text);
    // A file with no usable rows must not wipe the data the site is showing.
    if (recipes.length === 0) {
        context.warn(`rejected blob=${name} reason=no-usable-rows rowsRead=${insights.quality.rowsRead}`);
        return;
    }
    const store = (0, store_1.getStore)();
    const datasetVersion = `${name}@${new Date().toISOString()}`;
    const up = await store.upsertRecipes(recipes, datasetVersion);
    if (up.failed > 0) {
        // Throwing makes the Functions runtime retry the whole run; the writes are upserts with
        // fixed ids, so running twice is safe.
        throw new Error(`processCsv: ${up.failed} of ${recipes.length} writes failed for ${name}`);
    }
    const del = await store.deleteOtherVersions(datasetVersion);
    await store.saveInsights({ id: "current", ...insights, datasetVersion, sourceBlob: name, processedAt: new Date().toISOString() });
    // One line per run, in a fixed shape, so it is easy to find in the logs (the traces table).
    context.log(`processed blob=${name} rowsRead=${insights.quality.rowsRead} rowsUsed=${insights.quality.rowsUsed} ` +
        `written=${up.written} deleted=${del.deleted} ru=${up.ru + del.ru} ms=${Date.now() - started}`);
}
functions_1.app.storageBlob("processCsv", {
    path: "uploads/{name}",
    // Its own connection, as Microsoft recommends for anything that is not the Functions host itself.
    // In Azure: UploadsStorage__blobServiceUri + UploadsStorage__queueServiceUri +
    // UploadsStorage__credential=managedidentity (no key), as in Week 7 Day 2.
    connection: "UploadsStorage",
    source: "EventGrid",
    handler: processCsv,
});
//# sourceMappingURL=processCsv.js.map