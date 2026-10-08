import { expect, test } from "bun:test";
import { readObjectSchemaBlock, stripObjectMarkers } from "../../shared/templateMarkers";
import { templateObjectMetadata } from "../../shared/templateDiagnostics";
import { validateTemplatePayload } from "./lib/validation";

const schemaPattern = /\[\[OBJECT_SCHEMA\]\]\s*([\s\S]*?)\s*\[\[\/OBJECT_SCHEMA\]\]/;

const guidancePattern = /\[\[OBJECT_TABLE_GUIDANCE\]\][\s\S]*?\[\[\/OBJECT_TABLE_GUIDANCE\]\]\s*/g;

const samples = [
  "",
  "Plain description",
  '  Lines\n\n[[OBJECT_TABLE_GUIDANCE]]\nReturn rows\n[[/OBJECT_TABLE_GUIDANCE]]\n\n[[OBJECT_SCHEMA]]\n{"columns":[]}\n[[/OBJECT_SCHEMA]]',
  "[[OBJECT_SCHEMA]]   [[/OBJECT_SCHEMA]] tail",
  "[[OBJECT_SCHEMA]] unterminated",
  '[[OBJECT_SCHEMA]]{"a":1}[[/OBJECT_SCHEMA]] then [[OBJECT_SCHEMA]]{"b":2}[[/OBJECT_SCHEMA]]',
  "a [[OBJECT_TABLE_GUIDANCE]]x[[/OBJECT_TABLE_GUIDANCE]]  b [[OBJECT_TABLE_GUIDANCE]]y[[/OBJECT_TABLE_GUIDANCE]]\tc",
  "a [[OBJECT_TABLE_GUIDANCE]] open [[OBJECT_TABLE_GUIDANCE]] still open",
  "[[OBJECT_TABLE_GUIDANCE]][[OBJECT_SCHEMA]]{}[[/OBJECT_SCHEMA]][[/OBJECT_TABLE_GUIDANCE]] after",
  " [[OBJECT_SCHEMA]] {}﻿[[/OBJECT_SCHEMA]] ",
];

test("marker parsing matches the previous regular expressions", () => {
  for (const sample of samples) {
    expect(readObjectSchemaBlock(sample)).toBe(sample.match(schemaPattern)?.[1]);
    expect(stripObjectMarkers(sample)).toBe(sample.replace(schemaPattern, "").replace(guidancePattern, "").trim());
  }
});

test("crafted table descriptions are checked in linear time", () => {
  const descriptions = [
    `[[OBJECT_SCHEMA]]${" ".repeat(200_000)}x`,
    "[[OBJECT_TABLE_GUIDANCE]]".repeat(20_000),
    `[[OBJECT_SCHEMA]]${" ".repeat(100_000)}[[OBJECT_SCHEMA]]${" ".repeat(100_000)}`,
  ];

  const started = performance.now();

  for (const description of descriptions) {
    templateObjectMetadata({ name: "rows", description, data_type: "array<object>" });

    try {
      validateTemplatePayload({ name: "Crafted", fields: [{ name: "rows", description, data_type: "array<object>" }] });
    } catch {
      // Rejection is fine; only the time spent deciding matters here.
    }
  }

  expect(performance.now() - started).toBeLessThan(2_000);
});
