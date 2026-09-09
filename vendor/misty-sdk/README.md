# Public Misty SDK packages

Self-contained npm archives built from the independent misty-sdk repository. They include compiled JavaScript, declarations and source maps with embedded source. No private server source, credentials or sibling workspace links are required.

Update from the Host checkout with `npm run sdk:sync -- /path/to/misty-sdk`. The command checks the public source and isolated package consumer before refreshing both the Host and misty-apps snapshots and lockfiles. Archives use content hashes so npm cannot silently reuse an older build of the same development version. Nothing is published by this command.
