import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tokens = JSON.parse(
  readFileSync(new URL("../src/styles/tokens.json", import.meta.url), "utf8"),
);
const rgb = (hex) =>
  hex
    .slice(1, 7)
    .match(/../g)
    .map((value) => parseInt(value, 16) / 255);
const blend = (front, back) => {
  const alpha = front.length === 9 ? parseInt(front.slice(7), 16) / 255 : 1;
  return rgb(front).map(
    (value, i) => value * alpha + rgb(back)[i] * (1 - alpha),
  );
};
const luminance = (color) =>
  color
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (front, back) => {
  const a = luminance(front),
    b = luminance(back);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

for (const [mode, colors] of Object.entries(tokens.themes)) {
  test(`${mode}: text and semantic actions remain readable on actual surfaces`, () => {
    for (const surface of [
      "background",
      "card",
      "muted",
      "popover",
      "sidebar",
      "accent",
    ]) {
      const background = blend(colors[surface], colors.background);
      for (const name of [
        "foreground",
        "muted-foreground",
        "primary",
        "success",
        "info",
        "warning",
        "destructive",
      ]) {
        assert.ok(
          contrast(rgb(colors[name]), background) >= 4.5,
          `${mode} ${name} on ${surface}`,
        );
      }
    }
    assert.ok(
      contrast(rgb(colors["primary-foreground"]), rgb(colors.primary)) >= 4.5,
    );
    assert.ok(contrast(rgb(colors.input), rgb(colors.background)) >= 3);
  });
}

test("brand colors are preserved while typography has no network dependency", () => {
  assert.equal(tokens.themes.light["opc-primary"], "#7C6CFF");
  assert.equal(tokens.themes.dark["opc-primary"], "#4ADE80");
  assert.match(tokens.shared["opc-font-body"], /system-ui/);
  assert.match(tokens.shared["opc-font-mono"], /ui-monospace/);
  const css = readFileSync(
    new URL("../src/styles/tokens.css", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(css, /https?:|@import|url\(/);
});

test("custom Hero regions retain readable text and focus on extreme uploaded backgrounds", () => {
  const shared = tokens.shared;
  for (const [mode, back] of [
    ["light", "#D1D1D1"],
    ["dark", "#595959"],
  ]) {
    for (const role of ["foreground", "muted-foreground"]) {
      const front = shared[`opc-hero-${mode}-${role}`];
      assert.ok(
        contrast(blend(front, back), rgb(back)) >= 4.5,
        `${mode} ${role} against extreme artwork`,
      );
    }
    assert.ok(
      contrast(rgb(shared[`opc-hero-${mode}-ring`]), rgb(back)) >= 3,
      `${mode} focus`,
    );
  }
});
