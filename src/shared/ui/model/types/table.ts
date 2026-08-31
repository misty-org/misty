import type * as React from "react";

export type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  unwrapped?: boolean;
};
