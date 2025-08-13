# AFFiNE MCP Server (affine-mcp)

This package exposes your AFFiNE workspace to Model Context Protocol (MCP) clients via a local MCP server. It lets AI agents search documents, inspect metadata, manage comments, publish/unpublish docs, and query workspace info through typed MCP tools.

## Features

- Search documents across workspaces with highlights
- Get document metadata and version history
- Create, list, resolve, and delete comments
- Publish and unpublish documents
- List documents with pagination and details
- List and delete blobs/files
- List workspaces and fetch workspace details

## Requirements

- Bun (tested) or Node.js 20+
- AFFiNE credentials: an access token with API access

Environment variables used by the server:

- `AFFINE_ACCESS_TOKEN` (required): token for AFFiNE API.
- `AFFINE_API_URL` (optional): defaults to `https://app.affine.pro`.
- `AFFINE_WORKSPACE_ID` (optional): default workspace for some tools.
- `DEBUG` (optional): set to `true` to enable verbose logs.

Note: The entrypoint uses ESM `import` syntax. Running with Bun works out of the box. If you prefer Node.js, ensure your environment supports ESM for `.js` (e.g., Node 20 with `"type": "module"` in your project) or run via Bun.

## Usage

### Using with Claude Desktop (example)

Add to your Claude Desktop MCP config (adjust paths to your system):

```json
{
  "mcpServers": {
    "affine": {
      "command": "npx",
      "args": ["-y", "affine-mcp"],
      "env": {
        "AFFINE_API_URL": "https://app.affine.pro",
        "AFFINE_ACCESS_TOKEN": "${AFFINE_ACCESS_TOKEN}",
        "AFFINE_WORKSPACE_ID": "${AFFINE_WORKSPACE_ID}"
      }
    }
  }
}
```

## Development


### MCP Inspector (recommended for testing)

You can use infisical in conjunction with the inspect script to run and debug the server locally.

Without infisical:

```bash
# Pass envs through the Inspector to the server
bunx @modelcontextprotocol/inspector \
  -e DEBUG=true \
  -e AFFINE_API_URL=$AFFINE_API_URL \
  -e AFFINE_ACCESS_TOKEN=$AFFINE_ACCESS_TOKEN \
  -e AFFINE_WORKSPACE_ID=$AFFINE_WORKSPACE_ID \
  bun index.js
```

(or just run `bunx @modelcontextprotocol/inspector` and fill in the envs manually in the UI)


## Available Tools

- `search_documents`: search for documents (optionally within a workspace).
- `get_document`: fetch document metadata by `docId` and `workspaceId`.
- `list_workspaces`: list accessible workspaces.
- `get_workspace_info`: fetch workspace details and quotas.
- `publish_document` / `unpublish_document`: toggle public access for a doc.
- `create_comment`: create a comment on a document.
- `get_comments`: fetch comments for a document.
- `resolve_comment` / `delete_comment`: manage comment lifecycle.
- `advanced_search`: boolean/fielded search with highlights and limits.
- `get_document_history`: fetch version history for a document.
- `list_blobs` / `delete_blob`: manage stored blobs/files.
- `list_documents`: list documents in a workspace with pagination.

Notes:
- The AFFiNE GraphQL API does not seem to expose full document content; for now this server returns metadata, search snippets, and comment/history data where available.

## Examples

Search documents across a workspace:

```jsonc
{
  "name": "search_documents",
  "arguments": { "query": "meeting notes", "workspaceId": "ws_123", "limit": 5 }
}
```

Get a document’s metadata:

```jsonc
{
  "name": "get_document",
  "arguments": { "docId": "doc_abc", "workspaceId": "ws_123" }
}
```

Create a comment:

```jsonc
{
  "name": "create_comment",
  "arguments": {
    "docId": "doc_abc",
    "workspaceId": "ws_123",
    "docTitle": "Project Plan",
    "docMode": "page",
    "content": { "text": "Let’s clarify the timeline." },
    "mentions": []
  }
}
```

## Get an Access Token

You can generate an AFFiNE API token via the GraphQL API using cookies from an authenticated browser session.

Steps:
- Log in to your AFFiNE instance in a browser.
- Open devtools → Network, copy the full `Cookie` header from any authenticated request.
- Run the mutation below against your instance’s GraphQL endpoint.

Example (replace cookie and host):

```bash
curl -X POST https://your-affine-domain/graphql \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR VALUE FROM AUTHENTICATED REQUEST HEADERS HERE" \
  -H "x-affine-version: 0.24.0" \
  -d '{
    "query": "mutation GenerateAccessToken($input: GenerateAccessTokenInput!) { generateUserAccessToken(input: $input) { id name token createdAt expiresAt } }",
    "variables": {
      "input": {
        "name": "API Token"
      }
    }
  }'
```

The response includes `token`, which you can set as `AFFINE_ACCESS_TOKEN` for this server.

Note: Use your base host in `AFFINE_API_URL` (no `/graphql`, just the origin, e.g. `https://your-affine-domain`).

## MCP Client via npx

Example MCP client config using `npx` to run this package without a global install:

```json
"affine": {
  "command": "npx",
  "args": ["-y", "affine-mcp"],
  "env": {
    "AFFINE_API_URL": "https://your-affine-domain",
    "AFFINE_ACCESS_TOKEN": "your-access-token",
    "AFFINE_WORKSPACE_ID": "default-workspace-id"
  }
}
```

Workspace ID: open AFFiNE in the browser; the workspace ID is visible in the URL.

## Notes and limitations

- Document bodies are not returned by the public GraphQL API; tools focus on metadata, search, and comments/history.
- Ensure your AFFiNE token has access to the target workspaces and features.
