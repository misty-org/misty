export interface CsvLogin {
  site: string;
  username: string;
  password: string;
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

const siteColumns = ["url", "origin", "site", "name", "hostname"];
const userColumns = ["username", "login", "user", "email", "login_username"];
const passwordColumns = ["password", "login_password"];

/** Reads a password export from Chrome, Edge, Firefox, Safari or 1Password-style CSV files. */
export function parseLoginsCsv(text: string): CsvLogin[] {
  const [header, ...rows] = parseRows(text);
  if (!header) return [];
  const names = header.map((name) => name.trim().toLowerCase());
  // Earlier candidates win, so a "url" column beats a "name" column.
  const find = (candidates: string[]) => {
    for (const candidate of candidates) {
      const index = names.indexOf(candidate);
      if (index >= 0) return index;
    }
    return -1;
  };
  const site = find(siteColumns);
  const username = find(userColumns);
  const password = find(passwordColumns);
  if (site < 0 || password < 0) return [];
  return rows
    .map((row) => ({
      site: (row[site] ?? "").trim(),
      username: username < 0 ? "" : (row[username] ?? "").trim(),
      password: row[password] ?? "",
    }))
    .filter((login) => login.site && login.password);
}

/** Passwords are written exactly; other columns are kept from running as spreadsheet formulas. */
function cell(value: string, exact = false): string {
  const safe = !exact && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function loginsToCsv(logins: CsvLogin[]): string {
  const lines = ["name,url,username,password"];
  for (const login of logins) {
    lines.push(
      [cell(login.site), cell(login.site), cell(login.username), cell(login.password, true)].join(
        ",",
      ),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
