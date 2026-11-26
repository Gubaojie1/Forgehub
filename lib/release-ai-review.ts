import * as XLSX from "xlsx";

export type ReviewSource = { id: string; label: string; text: string };
export type ReviewEvidence = ReviewSource & { artifactId?: string; sheet?: string; row?: number };
export type Coverage = "covered" | "partial" | "missing" | "failed";
type Finding = { source: ReviewSource; coverage: Coverage; note: string; evidence: ReviewEvidence[] };
export type ReleaseAiReview = {
  changes: Finding[];
  history: (Finding & { handling: "fixed" | "deferred" | "unaffected" | "unmentioned"; development: ReviewSource[] })[];
  warnings: string[];
};

export function sourceLines(text: string | null, prefix: string, label: string) {
  const lines = (text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(0, 30).map((text, index): ReviewSource => ({
    id: prefix + (index + 1), label, text: text.slice(0, 700),
  }));
}

export function readReviewReport(data: ArrayBuffer, file: { id: string; name: string }, prefix: string, budget: number) {
  const book = XLSX.read(data, { type: "array", cellFormula: false, cellHTML: false });
  const evidence: ReviewEvidence[] = [];
  let remaining = budget;
  let truncated = false;
  for (const sheet of book.SheetNames) {
    const rows = new Map<number, { col: number; text: string }[]>();
    for (const [address, raw] of Object.entries(book.Sheets[sheet])) {
      if (!/^[A-Z]+\d+$/.test(address)) continue;
      const cell = raw as XLSX.CellObject;
      if (cell.v == null || cell.t === "e") continue;
      const text = XLSX.utils.format_cell(cell).trim().replace(/\s+/g, " ");
      if (!text) continue;
      const { r, c } = XLSX.utils.decode_cell(address);
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r)!.push({ col: c, text });
    }
    for (const [index, cells] of [...rows].sort(([a], [b]) => a - b)) {
      const original = cells.sort((a, b) => a.col - b.col).map(({ col, text }) => XLSX.utils.encode_col(col) + ": " + text).join(" | ");
      const text = original.slice(0, 1000);
      remaining -= text.length + sheet.length + file.name.length + 100;
      if (remaining < 0 || evidence.length === 400) return { evidence, truncated: true, remaining: 0 };
      if (original.length > text.length) truncated = true;
      const row = index + 1;
      evidence.push({ id: prefix + "-" + (evidence.length + 1), label: file.name, artifactId: file.id, sheet, row, text });
    }
  }
  return { evidence, truncated, remaining };
}

type ModelFinding = { sourceId?: string; coverage?: string; note?: string; evidenceIds?: string[]; handling?: string; developmentIds?: string[] };
export function normalizeReleaseReview(raw: unknown, changes: ReviewSource[], history: ReviewSource[], evidence: ReviewEvidence[], warnings: string[], development = changes): ReleaseAiReview {
  const result = raw as { changes?: unknown; history?: unknown } | null;
  if (!Array.isArray(result?.changes) || !Array.isArray(result.history)) throw new Error("AI 返回格式异常");
  const index = (items: ModelFinding[]) => new Map(items.filter((item) => typeof item?.sourceId === "string").map((item) => [item.sourceId, item]));
  const changeMap = index(result.changes);
  const historyMap = index(result.history);
  const evidenceMap = new Map(evidence.map((item) => [item.id, item]));
  const developmentMap = new Map(development.map((item) => [item.id, item]));
  function refs<T>(ids: unknown, sources: Map<string, T>): T[] {
    return Array.isArray(ids) ? [...new Set(ids)].slice(0, 6).flatMap((id) => typeof id === "string" && sources.has(id) ? [sources.get(id)!] : []) : [];
  }
  function finding(source: ReviewSource, raw?: ModelFinding): Finding {
    const cited = refs(raw?.evidenceIds, evidenceMap);
    const coverage = cited.length && ["covered", "partial", "failed"].includes(raw?.coverage ?? "") ? raw!.coverage as Coverage : "missing";
    return {
      source, coverage, evidence: cited,
      note: !raw ? "AI 未返回此项判断，请人工核对。" :
        coverage !== raw.coverage ? "未找到可核验的对应测试依据，请人工核对。" :
        typeof raw.note === "string" ? raw.note.trim().slice(0, 400) : "",
    };
  }
  return {
    changes: changes.map((source) => finding(source, changeMap.get(source.id))),
    history: history.map((source) => {
      const raw = historyMap.get(source.id);
      const cited = refs(raw?.developmentIds, developmentMap);
      const handling = cited.length && ["fixed", "deferred", "unaffected"].includes(raw?.handling ?? "") ? raw!.handling as "fixed" | "deferred" | "unaffected" : "unmentioned";
      const check = finding(source, raw);
      return { ...check, ...(handling !== "fixed" ? { coverage: "missing" as const, evidence: [] } : {}), handling, development: cited,
        note: !raw ? check.note : handling === "unmentioned" ? "未找到可核验的开发处置说明，不代表未修复。" : handling === "fixed" ? check.note : "" };
    }),
    warnings,
  };
}
