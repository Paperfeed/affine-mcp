#!/usr/bin/env node

/**
 * AFFiNE MCP Client
 *
 * This MCP server allows AI Agents to access your AFFiNE workspace
 * documents, search functionality, and workspace information.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    McpError,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

class AFFiNEMCPServer {
    constructor() {
        this.server = new Server(
            {
                name: 'affine-mcp-server',
                version: '1.0.0',
            },
            {
                capabilities: {
                    resources: {},
                    tools: {},
                },
            }
        );

        this.apiUrl = process.env.AFFINE_API_URL;
        this.accessToken = process.env.AFFINE_ACCESS_TOKEN;
        this.workspaceId = process.env.AFFINE_WORKSPACE_ID;

        if (!this.accessToken) {
            throw new Error('AFFINE_ACCESS_TOKEN environment variable is required');
        }

        this.setupHandlers();
    }

    async makeGraphQLRequest(query, variables = {}) {
        try {
            const response = await fetch(`${this.apiUrl}/graphql`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.accessToken}`,
                },
                body: JSON.stringify({
                    query,
                    variables,
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.errors) {
                throw new Error(`GraphQL Error: ${data.errors[0].message}`);
            }

            return data.data;
        } catch (error) {
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to query AFFiNE API: ${error.message}`
            );
        }
    }

    setupHandlers() {
        // List available resources
        this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
            const workspaces = await this.getWorkspaces();
            const resources = [];

            // Add workspace resources
            for (const workspace of workspaces) {
                resources.push({
                    uri: `affine://workspace/${workspace.id}`,
                    mimeType: 'application/json',
                    name: `Workspace: ${workspace.name}`,
                    description: `Access to workspace "${workspace.name}" documents and metadata`,
                });

                resources.push({
                    uri: `affine://workspace/${workspace.id}/docs`,
                    mimeType: 'application/json',
                    name: `Documents in ${workspace.name}`,
                    description: `List all documents in workspace "${workspace.name}"`,
                });
            }

            // Add search resource
            resources.push({
                uri: 'affine://search',
                mimeType: 'application/json',
                name: 'Document Search',
                description: 'Search across all accessible documents',
            });

            return { resources };
        });

        // Read specific resources
        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const { uri } = request.params;
            const url = new URL(uri);

            switch (url.protocol) {
                case 'affine:':
                    return this.handleAFFiNEResource(url);
                default:
                    throw new McpError(
                        ErrorCode.InvalidRequest,
                        `Unsupported URI scheme: ${url.protocol}`
                    );
            }
        });

        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: 'search_documents',
                        description: 'Search for documents across all workspaces',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                query: {
                                    type: 'string',
                                    description: 'Search query string',
                                },
                                workspaceId: {
                                    type: 'string',
                                    description: 'Optional: Limit search to specific workspace',
                                },
                                limit: {
                                    type: 'number',
                                    description: 'Maximum number of results to return (default: 10)',
                                    default: 10,
                                },
                            },
                            required: ['query'],
                        },
                    },
                    {
                        name: 'get_document',
                        description: 'Retrieve a specific document by ID',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                docId: {
                                    type: 'string',
                                    description: 'Document ID to retrieve',
                                },
                                workspaceId: {
                                    type: 'string',
                                    description: 'Workspace ID containing the document',
                                },
                            },
                            required: ['docId', 'workspaceId'],
                        },
                    },
                    {
                        name: 'list_workspaces',
                        description: 'Get all accessible workspaces',
                        inputSchema: {
                            type: 'object',
                            properties: {},
                        },
                    },
                    {
                        name: 'get_workspace_info',
                        description: 'Get detailed information about a workspace',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                workspaceId: {
                                    type: 'string',
                                    description: 'Workspace ID to get information for',
                                },
                            },
                            required: ['workspaceId'],
                        },
                    },
                ],
            };
        });

        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            switch (name) {
                case 'search_documents':
                    return this.searchDocuments(args.query, args.workspaceId, args.limit);
                case 'get_document':
                    return this.getDocument(args.docId, args.workspaceId);
                case 'list_workspaces':
                    return this.listWorkspaces();
                case 'get_workspace_info':
                    return this.getWorkspaceInfo(args.workspaceId);
                default:
                    throw new McpError(
                        ErrorCode.MethodNotFound,
                        `Unknown tool: ${name}`
                    );
            }
        });
    }

    async handleAFFiNEResource(url) {
        const pathParts = url.pathname.split('/').filter(Boolean);

        if (pathParts[0] === 'workspace') {
            const workspaceId = pathParts[1];

            if (pathParts[2] === 'docs') {
                // List documents in workspace
                const docs = await this.getWorkspaceDocs(workspaceId);
                return {
                    contents: [
                        {
                            uri: url.toString(),
                            mimeType: 'application/json',
                            text: JSON.stringify(docs, null, 2),
                        },
                    ],
                };
            } else {
                // Get workspace info
                const workspace = await this.getWorkspaceInfo(workspaceId);
                return {
                    contents: [
                        {
                            uri: url.toString(),
                            mimeType: 'application/json',
                            text: JSON.stringify(workspace, null, 2),
                        },
                    ],
                };
            }
        } else if (pathParts[0] === 'search') {
            const searchParams = new URLSearchParams(url.search);
            const query = searchParams.get('q') || '';
            const results = await this.searchDocuments(query);

            return {
                contents: [
                    {
                        uri: url.toString(),
                        mimeType: 'application/json',
                        text: JSON.stringify(results, null, 2),
                    },
                ],
            };
        }

        throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource path: ${url.pathname}`
        );
    }

    async getWorkspaces() {
        const query = `
      query {
        workspaces {
          id
          name
          public
          createdAt
        }
      }
    `;

        const data = await this.makeGraphQLRequest(query);
        return data.workspaces;
    }

    async getWorkspaceDocs(workspaceId) {
        const query = `
      query($workspaceId: String!) {
        workspace(id: $workspaceId) {
          docs(pagination: {first: 50}) {
            edges {
              node {
                id
                title
                createdAt
                updatedAt
                createdBy {
                  name
                }
                lastUpdatedBy {
                  name
                }
              }
            }
          }
        }
      }
    `;

        const data = await this.makeGraphQLRequest(query, { workspaceId });
        return data.workspace.docs.edges.map(edge => edge.node);
    }

    async searchDocuments(query, workspaceId = null, limit = 10) {
        if (workspaceId) {
            // Search within specific workspace
            const gqlQuery = `
        query($workspaceId: String!, $keyword: String!, $limit: Int!) {
          workspace(id: $workspaceId) {
            searchDocs(input: {keyword: $keyword, limit: $limit}) {
              docId
              title
              highlight
              createdAt
              updatedAt
            }
          }
        }
      `;

            const data = await this.makeGraphQLRequest(gqlQuery, {
                workspaceId,
                keyword: query,
                limit
            });

            return {
                content: [
                    {
                        type: 'text',
                        text: `Found ${data.workspace.searchDocs.length} documents matching "${query}" in workspace:\n\n` +
                            data.workspace.searchDocs.map(doc =>
                                `• **${doc.title}**\n  ${doc.highlight}\n  Document ID: ${doc.docId}`
                            ).join('\n\n'),
                    },
                ],
            };
        } else {
            // Search across all workspaces
            const workspaces = await this.getWorkspaces();
            const allResults = [];

            for (const workspace of workspaces) {
                try {
                    const gqlQuery = `
            query($workspaceId: String!, $keyword: String!, $limit: Int!) {
              workspace(id: $workspaceId) {
                name
                searchDocs(input: {keyword: $keyword, limit: $limit}) {
                  docId
                  title
                  highlight
                  createdAt
                  updatedAt
                }
              }
            }
          `;

                    const data = await this.makeGraphQLRequest(gqlQuery, {
                        workspaceId: workspace.id,
                        keyword: query,
                        limit: Math.ceil(limit / workspaces.length)
                    });

                    if (data.workspace.searchDocs.length > 0) {
                        allResults.push({
                            workspace: data.workspace.name,
                            docs: data.workspace.searchDocs,
                        });
                    }
                } catch (error) {
                    // Skip workspaces that can't be searched
                    continue;
                }
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `Search results for "${query}":\n\n` +
                            allResults.map(result =>
                                `**${result.workspace}:**\n` +
                                result.docs.map(doc =>
                                    `• **${doc.title}**\n  ${doc.highlight}\n  Document ID: ${doc.docId}`
                                ).join('\n')
                            ).join('\n\n'),
                    },
                ],
            };
        }
    }

    async getDocument(docId, workspaceId) {
        const query = `
      query($workspaceId: String!, $docId: String!) {
        workspace(id: $workspaceId) {
          doc(docId: $docId) {
            id
            title
            createdAt
            updatedAt
            createdBy {
              name
              email
            }
            lastUpdatedBy {
              name
              email
            }
            mode
            public
          }
        }
      }
    `;

        const data = await this.makeGraphQLRequest(query, { workspaceId, docId });
        const doc = data.workspace.doc;

        return {
            content: [
                {
                    type: 'text',
                    text: `**Document: ${doc.title}**\n\n` +
                        `**ID:** ${doc.id}\n` +
                        `**Created:** ${new Date(doc.createdAt).toLocaleString()}\n` +
                        `**Updated:** ${new Date(doc.updatedAt).toLocaleString()}\n` +
                        `**Created by:** ${doc.createdBy?.name || 'Unknown'}\n` +
                        `**Last updated by:** ${doc.lastUpdatedBy?.name || 'Unknown'}\n` +
                        `**Mode:** ${doc.mode}\n` +
                        `**Public:** ${doc.public ? 'Yes' : 'No'}\n\n` +
                        `*Note: Document content access may require additional API endpoints.*`,
                },
            ],
        };
    }

    async listWorkspaces() {
        const workspaces = await this.getWorkspaces();

        return {
            content: [
                {
                    type: 'text',
                    text: `**Available Workspaces:**\n\n` +
                        workspaces.map(ws =>
                            `• **${ws.name}**\n  ID: ${ws.id}\n  Public: ${ws.public ? 'Yes' : 'No'}\n  Created: ${new Date(ws.createdAt).toLocaleString()}`
                        ).join('\n\n'),
                },
            ],
        };
    }

    async getWorkspaceInfo(workspaceId) {
        const query = `
      query($workspaceId: String!) {
        workspace(id: $workspaceId) {
          id
          name
          public
          createdAt
          memberCount
          quota {
            name
            storageQuota
            usedStorageQuota
            memberLimit
            memberCount
          }
          owner {
            name
            email
          }
        }
      }
    `;

        const data = await this.makeGraphQLRequest(query, { workspaceId });
        const workspace = data.workspace;

        return {
            content: [
                {
                    type: 'text',
                    text: `**Workspace: ${workspace.name}**\n\n` +
                        `**ID:** ${workspace.id}\n` +
                        `**Public:** ${workspace.public ? 'Yes' : 'No'}\n` +
                        `**Created:** ${new Date(workspace.createdAt).toLocaleString()}\n` +
                        `**Owner:** ${workspace.owner.name} (${workspace.owner.email})\n` +
                        `**Members:** ${workspace.memberCount}\n\n` +
                        `**Quota Information:**\n` +
                        `• Plan: ${workspace.quota.name}\n` +
                        `• Storage: ${workspace.quota.usedStorageQuota} / ${workspace.quota.storageQuota}\n` +
                        `• Members: ${workspace.quota.memberCount} / ${workspace.quota.memberLimit}`,
                },
            ],
        };
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('AFFiNE MCP server running on stdio');
    }
}

// Run the server
const server = new AFFiNEMCPServer();
server.run().catch(console.error);