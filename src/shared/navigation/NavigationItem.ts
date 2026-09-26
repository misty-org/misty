export interface NavigationItem {
  readonly id: string;
  readonly label: string;
  readonly route: string;
  readonly children?: readonly NavigationItem[];
}
