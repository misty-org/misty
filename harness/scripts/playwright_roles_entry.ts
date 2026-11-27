import {
  beginAriaCaches,
  endAriaCaches,
  getAriaChecked,
  getAriaDisabled,
  getAriaExpanded,
  getAriaLevel,
  getAriaPressed,
  getAriaRole,
  getAriaSelected,
  getElementAccessibleNameText,
  isElementHiddenForAria,
} from "@injected/roleUtils";

const P = ((globalThis as Record<string, unknown>).__mistyAgentPageV1 ??= {}) as Record<string, unknown>;
P.aria = {
  role: getAriaRole,
  name: getElementAccessibleNameText,
  hidden: isElementHiddenForAria,
  checked: getAriaChecked,
  pressed: getAriaPressed,
  expanded: getAriaExpanded,
  level: getAriaLevel,
  disabled: getAriaDisabled,
  selected: getAriaSelected,
  begin: beginAriaCaches,
  end: endAriaCaches,
};
