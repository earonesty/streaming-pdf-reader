/** Only checks with recorded evidence can block the semantic review gate. */
export function classifyFindings(coverage, findings, checks = []) {
  return findings.map((finding) => {
    const verification = checks[finding.index]?.verification;
    const enforced =
      coverage === "focused-contracts" &&
      ["source-reviewed", "existing-regression"].includes(verification?.basis) &&
      typeof verification?.evidence === "string" &&
      verification.evidence.trim().length > 0;
    return { ...finding, enforced, ...(verification ? { verification } : {}) };
  });
}
export function reviewFails(report) {
  return report.some((row) => row.findings.some((finding) => finding.enforced === true));
}
export function reviewStatus(row) {
  if (reviewFails([row])) return "FAIL";
  if (row.findings.length) return "REVIEW";
  return row.coverage === "draft-document" ? "DRAFT MATCH" : "PASS";
}
