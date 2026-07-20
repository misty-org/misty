import type { SavedSearchRule } from "@/models/interfaces/services/misty-api";

export function smartFolderQueryFromRules(
  rules: SavedSearchRule[],
  matchMode: "all" | "any",
): string {
  const parts = rules
    .filter((rule) => rule.field !== "__match" && rule.value.trim())
    .map(smartFolderRuleQuery)
    .filter(Boolean);
  return matchMode === "any" && parts.length > 1 ? parts.join(" OR ") : parts.join(" ");
}

function smartFolderRuleQuery(rule: SavedSearchRule): string {
  const value = quoteSearchToken(rule.value.trim());
  if (!value) return "";
  switch (rule.field) {
    case "path":
      return `path:${value}`;
    case "kind":
      return `kind:${value}`;
    case "extension":
      return `ext:${value.replace(/^\./, "")}`;
    case "size":
      return `size${operatorSymbol(rule.operator)}${value}`;
    case "modified":
      return `modified${operatorSymbol(rule.operator)}${value}`;
    case "hidden":
      return `hidden:${value}`;
    case "tag":
      return `tag:${value}`;
    case "text":
    default:
      return rule.operator === "is_not" ? `-${value}` : value;
  }
}

function operatorSymbol(operator: string): string {
  if (operator === "gt" || operator === "after") return ":>";
  if (operator === "lt" || operator === "before") return ":<";
  if (operator === "is_not") return ":!";
  return ":";
}

function quoteSearchToken(value: string): string {
  if (!value) return "";
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}
