"use strict";
// CPSY 300 Team Project, Phase 2 — GIVEN CODE. Copy this file into your repository exactly where the starter
// zip puts it. You may change it, but explain any change in your report.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Tests for the Phase 2 back end, run with:  npm test
// They use an in-memory store instead of Cosmos DB, and fake trigger inputs instead of Azure.
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const functions_1 = require("@azure/functions");
const clean_1 = require("../src/lib/clean");
const store_1 = require("../src/lib/store");
const processCsv_1 = require("../src/functions/processCsv");
const api_1 = require("../src/functions/api");
const storeReview_1 = require("../src/functions/storeReview");
const csv = (0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, "..", "..", "test", "All_Diets.csv"), "utf8");
const ctx = (fn, meta = {}) => new functions_1.InvocationContext({ invocationId: "test", functionName: fn, triggerMetadata: meta });
(0, node_test_1.test)("cleaning gives the Phase 1 reference numbers", () => {
    const { recipes, insights } = (0, clean_1.analyseCsv)(csv);
    const q = insights.quality;
    strict_1.default.equal(q.rowsRead, 7806);
    strict_1.default.equal(q.removedDuplicates, 720);
    strict_1.default.equal(q.removedExtreme, 63);
    strict_1.default.equal(q.keptZeroProteinOrFat, 39);
    strict_1.default.equal(q.rowsUsed, 7023);
    strict_1.default.equal(recipes.length, 7023);
    const keto = insights.averages.find((a) => a.diet === "keto");
    strict_1.default.deepEqual([keto.protein, keto.carbs, keto.fat, keto.recipes], [99.8, 57.1, 152, 1449]);
    const vegan = insights.ratios.find((r) => r.diet === "vegan");
    strict_1.default.deepEqual([vegan.proteinToCarbs, vegan.carbsToFat], [0.23, 2.47]);
});
(0, node_test_1.test)("ids are stable, case-insensitive and Cosmos-safe", () => {
    strict_1.default.equal((0, clean_1.recipeId)("keto", "Keto Bread / Rolls?"), (0, clean_1.recipeId)("keto", "  keto bread / rolls? "));
    strict_1.default.match((0, clean_1.recipeId)("keto", "a/b?c#d"), /^[0-9a-f]{24}$/);
    strict_1.default.notEqual((0, clean_1.recipeId)("keto", "x"), (0, clean_1.recipeId)("paleo", "x"));
});
(0, node_test_1.test)("an upload stores recipes and insights once; a second upload replaces the first", async () => {
    const store = new store_1.MemoryStore();
    (0, store_1.setStore)(store);
    await (0, processCsv_1.processCsv)(Buffer.from(csv), ctx("processCsv", { name: "All_Diets.csv" }));
    strict_1.default.equal(store.recipes.size, 7023);
    strict_1.default.equal(store.insights?.sourceBlob, "All_Diets.csv");
    strict_1.default.equal(store.insights?.quality.rowsUsed, 7023);
    // Version 2: only the keto rows.
    const lines = csv.split(/\r?\n/);
    const v2 = [lines[0], ...lines.filter((l) => l.startsWith("keto,"))].join("\n");
    await (0, processCsv_1.processCsv)(Buffer.from(v2), ctx("processCsv", { name: "All_Diets_v2.csv" }));
    strict_1.default.equal(store.recipes.size, 1449);
    strict_1.default.ok([...store.recipes.values()].every((r) => r.diet === "keto"));
    strict_1.default.equal(store.insights?.sourceBlob, "All_Diets_v2.csv");
    strict_1.default.equal(store.insights?.averages.length, 1);
});
(0, node_test_1.test)("a file that is not a CSV, or has no usable rows, changes nothing", async () => {
    const store = new store_1.MemoryStore();
    (0, store_1.setStore)(store);
    await (0, processCsv_1.processCsv)(Buffer.from(csv), ctx("processCsv", { name: "All_Diets.csv" }));
    await (0, processCsv_1.processCsv)(Buffer.from("hello"), ctx("processCsv", { name: "notes.txt" }));
    await (0, processCsv_1.processCsv)(Buffer.from("Diet_type,Recipe_name,Cuisine_type,Protein(g),Carbs(g),Fat(g)\nketo,,x,1,2,3\n"), ctx("processCsv", { name: "bad.csv" }));
    strict_1.default.equal(store.recipes.size, 7023);
    strict_1.default.equal(store.insights?.sourceBlob, "All_Diets.csv");
});
(0, node_test_1.test)("messy rows are tidied or skipped", () => {
    const messy = [
        "Diet_type,Recipe_name,Cuisine_type,Protein(g),Carbs(g),Fat(g),Extraction_day,Extraction_time",
        " Keto ,Egg Cups, American ,20,2,15,x,y",
        "keto,Egg cups,american,25,2,15,x,y", // duplicate of the first (case-insensitive name)
        "paleo,Steak,american,,10,20,x,y", // blank protein
        "paleo,Ribs,american,abc,10,20,x,y", // not a number
        "vegan,Salad,mediterranean,0,12,0,x,y", // zeros: kept and counted
        "vegan,Giant Cake,american,10,1500,40,x,y", // extreme
    ].join("\n");
    const { recipes, insights } = (0, clean_1.analyseCsv)(messy);
    strict_1.default.equal(recipes.length, 2);
    strict_1.default.deepEqual([insights.quality.namesTidied, insights.quality.removedDuplicates, insights.quality.removedBlankOrNotANumber, insights.quality.removedExtreme, insights.quality.keptZeroProteinOrFat], [1, 1, 2, 1, 1]);
    strict_1.default.equal(recipes[0].diet, "keto");
    strict_1.default.equal(recipes[0].cuisine, "american");
});
(0, node_test_1.test)("the read API: insights, search with filter + keyword + pages, 404 before any upload", async () => {
    const store = new store_1.MemoryStore();
    (0, store_1.setStore)(store);
    const before = await (0, api_1.getInsights)(new functions_1.HttpRequest({ method: "GET", url: "http://localhost/api/insights" }), ctx("insights"));
    strict_1.default.equal(before.status, 404);
    await (0, processCsv_1.processCsv)(Buffer.from(csv), ctx("processCsv", { name: "All_Diets.csv" }));
    const ins = await (0, api_1.getInsights)(new functions_1.HttpRequest({ method: "GET", url: "http://localhost/api/insights" }), ctx("insights"));
    strict_1.default.equal(ins.status, 200);
    const r = await (0, api_1.searchRecipes)(new functions_1.HttpRequest({ method: "GET", url: "http://localhost/api/recipes?diet=Keto&q=CHICKEN&page=2&pageSize=5" }), ctx("recipes"));
    const body = r.jsonBody;
    strict_1.default.equal(body.page, 2);
    strict_1.default.equal(body.items.length, 5);
    strict_1.default.ok(body.total > 10);
    strict_1.default.ok(body.items.every((i) => i.diet === "keto" && i.name.toLowerCase().includes("chicken")));
    const silly = await (0, api_1.searchRecipes)(new functions_1.HttpRequest({ method: "GET", url: "http://localhost/api/recipes?page=-3&pageSize=9999" }), ctx("recipes"));
    const s = silly.jsonBody;
    strict_1.default.deepEqual([s.page, s.pageSize, s.total], [1, 50, 7023]);
});
(0, node_test_1.test)("reviews: stored from the queue once, bad ones rejected, latest first", async () => {
    const store = new store_1.MemoryStore();
    (0, store_1.setStore)(store);
    const msg = (o) => Buffer.from(JSON.stringify(o));
    await (0, storeReview_1.storeReview)(msg({ recipeId: "abc", recipeName: "Egg Cups", diet: "keto", rating: 5, comment: " Great ", createdAt: "2026-11-05T10:00:00Z" }), ctx("storeReview", { messageId: "m1", deliveryCount: 1 }));
    await (0, storeReview_1.storeReview)(msg({ recipeId: "abc", recipeName: "Egg Cups", diet: "keto", rating: 5, comment: " Great ", createdAt: "2026-11-05T10:00:00Z" }), ctx("storeReview", { messageId: "m1", deliveryCount: 2 }));
    await (0, storeReview_1.storeReview)({ recipeId: "def", rating: 3, comment: "ok", createdAt: "2026-11-05T11:00:00Z" }, ctx("storeReview", { messageId: "m2" }));
    await (0, storeReview_1.storeReview)(msg({ recipeId: "abc", rating: 9 }), ctx("storeReview", { messageId: "m3" }));
    await (0, storeReview_1.storeReview)("not json", ctx("storeReview", { messageId: "m4" }));
    strict_1.default.equal(store.reviews.size, 2);
    strict_1.default.equal(store.reviews.get("m1")?.comment, "Great");
    strict_1.default.equal((0, storeReview_1.toReview)({ recipeId: "x", rating: 2.5 }, "m"), null);
    const res = await (0, api_1.listReviews)(new functions_1.HttpRequest({ method: "GET", url: "http://localhost/api/reviews" }), ctx("reviews"));
    const list = res.jsonBody;
    strict_1.default.deepEqual(list.map((r) => r.id), ["m2", "m1"]);
    const one = await (0, api_1.listReviews)(new functions_1.HttpRequest({ method: "GET", url: "http://localhost/api/reviews?recipeId=abc" }), ctx("reviews"));
    strict_1.default.equal(one.jsonBody.length, 1);
});
(0, node_test_1.test)("a missing Cosmos DB data role answers 403, any other failure 500", async () => {
    const refused = new store_1.MemoryStore();
    refused.getInsights = async () => { throw Object.assign(new Error("Forbidden"), { code: 403 }); };
    (0, store_1.setStore)(refused);
    const r403 = await (0, api_1.getInsights)(new functions_1.HttpRequest({ method: "GET", url: "http://localhost/api/insights" }), ctx("insights"));
    strict_1.default.equal(r403.status, 403);
    const broken = new store_1.MemoryStore();
    broken.queryRecipes = async () => { throw new Error("network down"); };
    (0, store_1.setStore)(broken);
    const r500 = await (0, api_1.searchRecipes)(new functions_1.HttpRequest({ method: "GET", url: "http://localhost/api/recipes" }), ctx("recipes"));
    strict_1.default.equal(r500.status, 500);
    (0, store_1.setStore)(null);
});
//# sourceMappingURL=backend.test.js.map