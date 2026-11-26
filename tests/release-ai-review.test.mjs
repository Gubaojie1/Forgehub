import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as XLSX from "xlsx";
import { normalizeReleaseReview, readReviewReport, sourceLines } from "../lib/release-ai-review.ts";

test("Excel evidence preserves sheet and original row, including gaps", () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[], ["用例", "结果"], [], ["低电量唤醒", "失败"]]), "功耗测试");
  const buffer = XLSX.write(book, { type: "array", bookType: "xlsx" });
  const report = readReviewReport(buffer, { id: "report", name: "test.xlsx" }, "R1", 5000);
  assert.deepEqual(report.evidence.map(({ sheet, row, text }) => [sheet, row, text]), [
    ["功耗测试", 2, "A: 用例 | B: 结果"], ["功耗测试", 4, "A: 低电量唤醒 | B: 失败"],
  ]);
  assert.equal(readReviewReport(buffer, { id: "report", name: "test.xlsx" }, "R1", 1).truncated, true);
});

test("invalid evidence cannot mark coverage or invent historical fixes", () => {
  const changes = sourceLines("修复低电量唤醒\n修改蓝牙显示", "C", "版本更新说明");
  const history = sourceLines("低电量唤醒失败\n指示灯异常", "H", "V1 已知问题");
  const evidence = [{ id: "R1-1", label: "test.xlsx", sheet: "功耗", row: 4, text: "低电量唤醒：失败" }];
  const result = normalizeReleaseReview({
    changes: [{ sourceId: "C1", coverage: "covered", evidenceIds: ["made-up"] }],
    history: [{ sourceId: "H1", handling: "fixed", developmentIds: ["C1"], coverage: "failed", evidenceIds: ["R1-1"] },
      { sourceId: "H2", handling: "fixed", developmentIds: ["fake"], coverage: "covered", evidenceIds: ["R1-1"] }],
  }, changes, history, evidence, []);
  assert.deepEqual(result.changes.map((item) => item.coverage), ["missing", "missing"]);
  assert.deepEqual(result.history.map((item) => [item.handling, item.coverage]), [["fixed", "failed"], ["unmentioned", "missing"]]);
  assert.equal(result.history[0].evidence[0].row, 4);
});

test("approval review sends only this round's report and returns original evidence", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["正常电量唤醒", "通过"]]), "用例");
  const buffer = XLSX.write(book, { type: "array", bookType: "xlsx" });
  const libs = {
    "@/lib/release-ai-review": { normalizeReleaseReview, readReviewReport, sourceLines },
    "@/lib/storage": {
      AccessError: class extends Error {},
      requireAccess: async (_, role) => assert.equal(role, "admin"),
      getD1: () => ({ prepare(sql) {
        assert.match(sql, /^SELECT/);
        return { bind(...args) {
          return {
            first: async () => ({ release_id: "release", product_id: "product", status: "待终审", created_at: "2026-11-10", version: "V2", release_notes: "修复低电量唤醒", summary: "", test_result: "通过" }),
            all: async () => {
              if (!sql.includes("FROM artifacts")) return { results: [] };
              assert.match(sql, /release_request_id = \? AND release_id = \? AND product_id = \?/);
              assert.deepEqual(args, ["round", "release", "product"]);
              return { results: [{ id: "report", name: "test.xlsx", object_key: "report-key", size: buffer.byteLength }] };
            },
          };
        } };
      } }),
      getBucket: () => ({ get: async (key) => { assert.equal(key, "report-key"); return { body: new Response(buffer).body }; } }),
    },
  };
  const exported = {};
  const route = readFileSync(new URL("../app/api/release-requests/[id]/ai-review/route.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(route, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let called = false;
  new Function("exports", "require", "process", "fetch", js)(exported, (name) => libs[name], { env: { DASHSCOPE_API_KEY: "mock" } }, async (url, options) => {
    called = true;
    assert.match(url, /\/chat\/completions$/);
    const input = JSON.parse(options.body);
    assert.equal(input.model, "qwen-flash");
    const payload = JSON.parse(input.messages[1].content);
    assert.equal(payload.evidence[0].row, 1);
    assert.equal(payload.evidence[0].text, "A: 正常电量唤醒 | B: 通过");
    const content = JSON.stringify({ changes: [{ sourceId: "C1", coverage: "partial", note: "缺低电量用例", evidenceIds: ["R1-1"] }], history: [] });
    return Response.json({ choices: [{ message: { content } }] });
  });
  const response = await exported.POST(new Request("http://127.0.0.1/ai-review", { method: "POST" }), { params: Promise.resolve({ id: "round" }) });
  assert.equal(response.status, 200);
  assert.equal(called, true);
  const { changes } = await response.json();
  assert.equal(changes[0].coverage, "partial");
  assert.equal(changes[0].evidence[0].artifactId, "report");
});
