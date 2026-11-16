import * as React from "react";

/**
 * Whether the page under an overlay is already dimmed by a dialog, alert or sheet it opened
 * from. A dialog opened over another one draws no scrim of its own: the page is dimmed once,
 * and the dialog it opened from stays as it is behind it instead of going darker.
 */
export const PageDimmedContext = React.createContext(false);
