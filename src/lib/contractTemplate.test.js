import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  renderText, defaultClauses, clausesFromParagraphs, readDocxParagraphs, readTemplateFile, mapTemplateVariables, DEFAULT_CLAUSES, PLACEHOLDERS,
} from "./contractTemplate.js";

const para = (text, { bold = false, style = "" } = {}) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

async function docx(paragraphXml) {
  const zip = new JSZip();
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${paragraphXml}</w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

describe("renderText", () => {
  it("fills known placeholders and leaves unknown ones visible", () => {
    expect(renderText("{{customer}} in {{year}} {{nope}}", { customer: "Acme", year: 2027 })).toBe("Acme in 2027 {{nope}}");
    expect(renderText("{{ Customer }}", { customer: "Acme" })).toBe("Acme");
    expect(renderText(null, {})).toBe("");
  });
  it("only uses placeholders the editor documents", () => {
    const known = new Set(PLACEHOLDERS.map((p) => p.key));
    for (const c of DEFAULT_CLAUSES) for (const m of c.body.matchAll(/\{\{(\w+)\}\}/g)) expect(known.has(m[1])).toBe(true);
  });
});

describe("defaultClauses", () => {
  it("gives every clause its own id", () => {
    const c = defaultClauses();
    expect(c).toHaveLength(DEFAULT_CLAUSES.length);
    expect(new Set(c.map((x) => x.id)).size).toBe(c.length);
  });
});

describe("clausesFromParagraphs", () => {
  it("turns numbered and bold headings into titles with their paragraphs as the body", () => {
    const r = clausesFromParagraphs([
      { text: "SALES AGREEMENT" },
      { text: "1. Term" },
      { text: "The agreement runs for one year." },
      { text: "Rebate", bold: true },
      { text: "Paid yearly." },
      { text: "Subject to credit approval." },
    ]);
    expect(r.map((c) => c.title)).toEqual(["Term", "Rebate"]);
    expect(r[0].body).toBe("The agreement runs for one year.");
    expect(r[1].body).toBe("Paid yearly.\nSubject to credit approval.");
  });

  it("keeps text that has no heading as an untitled clause, and drops empty ones", () => {
    const r = clausesFromParagraphs([{ text: "Just a paragraph of terms that goes on for a good while longer than any heading would." }, { text: "  " }]);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe("");
  });

  it("maps [Customer Name] and [Year] style variables onto placeholders", () => {
    expect(mapTemplateVariables("Between [Customer Name] and us for [YEAR], target <<Target>>.")).toBe("Between {{customer}} and us for {{year}}, target {{target}}.");
  });
});

describe("Word templates", () => {
  it("reads paragraphs, bold and heading styles out of a .docx", async () => {
    const buf = await docx(
      para("Agreement", { style: "Title" }) + para("Payment", { bold: true }) + para("Thirty days from invoice &amp; statement.") + para("Term", { style: "Heading1" }) + para("One year."),
    );
    const paras = await readDocxParagraphs(buf);
    expect(paras.map((p) => [p.text, p.bold, p.heading])).toEqual([
      ["Agreement", false, true],
      ["Payment", true, false],
      ["Thirty days from invoice & statement.", false, false],
      ["Term", false, true],
      ["One year.", false, false],
    ]);
    const clauses = clausesFromParagraphs(paras);
    expect(clauses.map((c) => c.title)).toEqual(["Payment", "Term"]);
    expect(clauses[0].body).toContain("invoice & statement");
  });

  it("reads an uploaded file by its extension", async () => {
    const buf = await docx(para("Term", { bold: true }) + para("One year."));
    const file = { name: "Contract.docx", arrayBuffer: async () => buf };
    const r = await readTemplateFile(file);
    expect(r).toMatchObject({ kind: "clauses", source: "Contract.docx" });
    expect(r.clauses[0].title).toBe("Term");
  });

  it("keeps a PDF by name only and refuses other types", async () => {
    expect(await readTemplateFile({ name: "Old contract.PDF" })).toEqual({ kind: "attachment", source: "Old contract.PDF" });
    await expect(readTemplateFile({ name: "photo.png" })).rejects.toThrow(/Word/);
  });

  it("explains a document with no usable text, and a file that is not a Word document", async () => {
    const empty = await docx("");
    await expect(readTemplateFile({ name: "x.docx", arrayBuffer: async () => empty })).rejects.toThrow(/No clauses found/);
    const notDocx = await new JSZip().file("hello.txt", "hi").generateAsync({ type: "uint8array" });
    await expect(readTemplateFile({ name: "x.docx", arrayBuffer: async () => notDocx })).rejects.toThrow(/Word/);
  });
});
