import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./GugakSignage.iss", import.meta.url), "utf8");
const nextButton = source.match(/function NextButtonClick\([\s\S]*?\nend;/i)?.[0];

test("a LAN install can reach Network Mode before rejecting Integrated mode", () => {
  assert.ok(nextButton, "the Inno wizard must validate role/mode choices in NextButtonClick");

  const integratedLanGuards = [
    ...nextButton.matchAll(
      /if\s*\(\s*CurPageID\s*=\s*(RolePage|ModePage)\.ID\s*\)\s+and\s*\(\s*RolePage\.SelectedValueIndex\s*=\s*0\s*\)\s+and\s*\(\s*ModePage\.SelectedValueIndex\s*=\s*1\s*\)/gi,
    ),
  ];

  assert.equal(integratedLanGuards.length, 1, "the Integrated/LAN combination must be checked exactly once");
  assert.equal(
    integratedLanGuards[0][1],
    "ModePage",
    "the current LAN default must not block navigation from RolePage before the user can select Standalone",
  );
});
