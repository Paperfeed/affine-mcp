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
        this.debug = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
        this.debugLog('🚀 Starting AFFiNE MCP Server...');
        
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

        this.validateEnvironment();
        this.setupHandlers();
    }

    debugLog(message, data = null) {
        if (this.debug) {
            const timestamp = new Date().toISOString();
            console.error(`[${timestamp}] ${message}`);
            if (data) {
                console.error(JSON.stringify(data, null, 2));
            }
        }
    }

    /**
     * Generate a unique request ID for tracking
     */
    generateRequestId() {
        return Math.random().toString(36).substring(7);
    }

    /**
     * Format workspace for display
     */
    formatWorkspaceDisplay(workspace) {
        return `• **Workspace ${workspace.id}**\n  ID: ${workspace.id}\n  Public: ${workspace.public ? 'Yes' : 'No'}\n  Created: ${new Date(workspace.createdAt).toLocaleString()}`;
    }

    /**
     * Format document search result for display
     */
    formatDocumentResult(doc) {
        return `• **${doc.title}**\n  ${doc.highlight}\n  Document ID: ${doc.docId}`;
    }

    validateEnvironment() {
        this.debugLog('🔍 Validating environment variables...');
        
        this.apiUrl = process.env.AFFINE_API_URL || 'https://app.affine.pro';
        this.accessToken = process.env.AFFINE_ACCESS_TOKEN;
        this.workspaceId = process.env.AFFINE_WORKSPACE_ID;

        this.debugLog('Environment variables:', {
            AFFINE_API_URL: this.apiUrl,
            AFFINE_ACCESS_TOKEN: this.accessToken ? '***SET***' : 'NOT SET',
            AFFINE_WORKSPACE_ID: this.workspaceId || 'NOT SET',
            DEBUG: process.env.DEBUG || 'NOT SET'
        });

        if (!this.accessToken) {
            const error = 'AFFINE_ACCESS_TOKEN environment variable is required';
            this.debugLog('❌ ' + error);
            throw new Error(error);
        }

        this.debugLog('✅ Environment validation passed');
    }

    async makeGraphQLRequest(query, variables = {}) {
        const requestId = this.generateRequestId();
        this.debugLog(`📤 [${requestId}] Making GraphQL request to: ${this.apiUrl}/graphql`);
        this.debugLog(`📤 [${requestId}] Query:`, { query, variables });

        try {
            const requestBody = JSON.stringify({ query, variables });
            this.debugLog(`📤 [${requestId}] Request body:`, requestBody);

            const response = await fetch(`${this.apiUrl}/graphql`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.accessToken}`,
                    'User-Agent': 'AFFiNE-MCP-Client/1.0.0'
                },
                body: requestBody,
            });

            this.debugLog(`📥 [${requestId}] Response status: ${response.status} ${response.statusText}`);
            this.debugLog(`📥 [${requestId}] Response headers:`, Object.fromEntries(response.headers.entries()));

            if (!response.ok) {
                const errorText = await response.text();
                this.debugLog(`❌ [${requestId}] Error response body:`, errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            this.debugLog(`📥 [${requestId}] Response data:`, data);

            if (data.errors) {
                this.debugLog(`❌ [${requestId}] GraphQL errors:`, data.errors);
                const errorMessage = data.errors.map(e => e.message).join(', ');
                throw new Error(`GraphQL Error: ${errorMessage}`);
            }

            if (!data.data) {
                throw new Error('GraphQL response missing data field');
            }

            this.debugLog(`✅ [${requestId}] GraphQL request successful`);
            return data.data;
        } catch (error) {
            this.debugLog(`❌ [${requestId}] GraphQL request failed:`, {
                message: error.message,
                stack: error.stack
            });
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to query AFFiNE API [${requestId}]: ${error.message}`
            );
        }
    }

    setupHandlers() {
        this.debugLog('🔧 Setting up MCP handlers...');

        // List available resources
        this.server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
            const requestId = this.generateRequestId();
            this.debugLog(`📋 [${requestId}] ListResources request:`, request);

            try {
                const workspaces = await this.getWorkspaces();
                const resources = [];

                // Add workspace resources
                for (const workspace of workspaces) {
                    resources.push({
                        uri: `affine://workspace/${workspace.id}`,
                        mimeType: 'application/json',
                        name: `Workspace: ${workspace.id}`,
                        description: `Access to workspace "${workspace.id}" documents and metadata`,
                    });

                    resources.push({
                        uri: `affine://workspace/${workspace.id}/docs`,
                        mimeType: 'application/json',
                        name: `Documents in ${workspace.id}`,
                        description: `List all documents in workspace "${workspace.id}"`,
                    });
                }

                // Add search resource
                resources.push({
                    uri: 'affine://search',
                    mimeType: 'application/json',
                    name: 'Document Search',
                    description: 'Search across all accessible documents',
                });

                this.debugLog(`✅ [${requestId}] ListResources response:`, { resourceCount: resources.length });
                return { resources };
            } catch (error) {
                this.debugLog(`❌ [${requestId}] ListResources error:`, { message: error.message, stack: error.stack });
                throw error;
            }
        });

        // Read specific resources
        this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
            const requestId = this.generateRequestId();
            this.debugLog(`📖 [${requestId}] ReadResource request:`, request);

            try {
                const { uri } = request.params;
                const url = new URL(uri);
                this.debugLog(`📖 [${requestId}] Parsing URI:`, { uri, protocol: url.protocol, pathname: url.pathname });

                if (url.protocol !== 'affine:') {
                    throw new McpError(
                        ErrorCode.InvalidRequest,
                        `Unsupported URI scheme: ${url.protocol}`
                    );
                }

                const result = await this.handleAFFiNEResource(url);
                this.debugLog(`✅ [${requestId}] ReadResource response:`, { contentCount: result.contents?.length });
                return result;
            } catch (error) {
                this.debugLog(`❌ [${requestId}] ReadResource error:`, { message: error.message, stack: error.stack });
                throw error;
            }
        });

        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
            const requestId = this.generateRequestId();
            this.debugLog(`🛠️ [${requestId}] ListTools request:`, request);

            const result = {
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
            
            this.debugLog(`✅ [${requestId}] ListTools response:`, { toolCount: result.tools.length });
            return result;
        });

        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const requestId = this.generateRequestId();
            this.debugLog(`🔧 [${requestId}] CallTool request:`, request);

            try {
                const { name, arguments: args } = request.params;
                this.debugLog(`🔧 [${requestId}] Calling tool: ${name}`, args);

                const toolHandlers = {
                    'search_documents': () => this.searchDocuments(args.query, args.workspaceId, args.limit),
                    'get_document': () => this.getDocument(args.docId, args.workspaceId),
                    'list_workspaces': () => this.listWorkspaces(),
                    'get_workspace_info': () => this.getWorkspaceInfo(args.workspaceId)
                };

                const handler = toolHandlers[name];
                if (!handler) {
                    throw new McpError(
                        ErrorCode.MethodNotFound,
                        `Unknown tool: ${name}`
                    );
                }

                const result = await handler();
                this.debugLog(`✅ [${requestId}] CallTool response for ${name}:`, { contentCount: result.content?.length });
                return result;
            } catch (error) {
                this.debugLog(`❌ [${requestId}] CallTool error:`, { message: error.message, stack: error.stack });
                throw error;
            }
        });

        this.debugLog('✅ MCP handlers setup complete');
    }

    async handleAFFiNEResource(url) {
        // Handle different URI formats:
        // affine://workspace/{workspaceId}
        // affine://workspace/{workspaceId}/docs  
        // affine://search
        
        const hostname = url.hostname;
        const pathParts = url.pathname.split('/').filter(Boolean);
        
        this.debugLog(`🔍 Parsing AFFiNE resource:`, {
            hostname,
            pathname: url.pathname,
            pathParts,
            fullUrl: url.toString()
        });

        // Check if this is a workspace resource
        if (hostname === 'workspace' && pathParts.length > 0) {
            const workspaceId = pathParts[0]; // Extract workspace ID from path
            
            if (pathParts.length > 1 && pathParts[1] === 'docs') {
                // List documents in workspace: affine://workspace/{workspaceId}/docs
                this.debugLog(`📑 Fetching documents for workspace: ${workspaceId}`);
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
                // Get workspace info: affine://workspace/{workspaceId}
                this.debugLog(`🏢 Fetching workspace info for: ${workspaceId}`);
                try {
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
                } catch (error) {
                    this.debugLog(`⚠️ Workspace info failed, trying to list documents instead`);
                    // If workspace info fails, try to list documents as fallback
                    try {
                        const docs = await this.getWorkspaceDocs(workspaceId);
                        return {
                            contents: [
                                {
                                    uri: url.toString(),
                                    mimeType: 'application/json',
                                    text: JSON.stringify({
                                        error: 'Could not access workspace info, but found documents:',
                                        workspaceId,
                                        documents: docs
                                    }, null, 2),
                                },
                            ],
                        };
                    } catch (docsError) {
                        // If both fail, throw the original error
                        throw error;
                    }
                }
            }
        } else if (hostname === 'search') {
            // Handle search: affine://search?q=query
            this.debugLog(`🔍 Handling search request`);
            const searchParams = new URLSearchParams(url.search);
            const query = searchParams.get('q') || '';
            
            if (!query.trim()) {
                // If no search query provided, return empty results with explanation
                return {
                    contents: [
                        {
                            uri: url.toString(),
                            mimeType: 'application/json',
                            text: JSON.stringify({
                                message: 'No search query provided. Use ?q=your-search-term to search documents.',
                                example: 'affine://search?q=meeting notes'
                            }, null, 2),
                        },
                    ],
                };
            }
            
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
            `Unknown resource format. Expected affine://workspace/{id} or affine://search?q=query, got: ${url.toString()}`
        );
    }

    async getWorkspaces() {
        const query = `
      query {
        workspaces {
          id
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
        // Handle empty or whitespace-only queries
        if (!query || !query.trim()) {
            if (workspaceId) {
                // If searching a specific workspace, list all documents instead
                const docs = await this.getWorkspaceDocs(workspaceId);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `**All documents in workspace ${workspaceId}:**\n\n` +
                                docs.map(doc => 
                                    `• **${doc.title}**\n  ID: ${doc.id}\n  Created: ${new Date(doc.createdAt).toLocaleString()}\n  Updated: ${new Date(doc.updatedAt).toLocaleString()}`
                                ).join('\n\n'),
                        },
                    ],
                };
            } else {
                // If searching all workspaces, return a helpful message
                return {
                    content: [
                        {
                            type: 'text',
                            text: `**No search query provided**\n\nPlease provide a search query to find documents across your workspaces.\n\nExample searches:\n• "meeting notes"\n• "project plan"\n• "todo"`,
                        },
                    ],
                };
            }
        }

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
                            data.workspace.searchDocs.map(doc => this.formatDocumentResult(doc)).join('\n\n'),
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
                id
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
                            workspaceId: data.workspace.id,
                            docs: data.workspace.searchDocs,
                        });
                    }
                } catch (error) {
                    // Skip workspaces that can't be searched
                    this.debugLog(`⚠️ Skipping workspace ${workspace.id} due to error:`, error.message);
                    continue;
                }
            }

            if (allResults.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `No documents found matching "${query}" across your workspaces.`,
                        },
                    ],
                };
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `Search results for "${query}":\n\n` +
                            allResults.map(result =>
                                `**Workspace ${result.workspaceId}:**\n` +
                                result.docs.map(doc => this.formatDocumentResult(doc)).join('\n')
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
                    text: `**Available Workspaces:**\n\n${workspaces.map(ws => this.formatWorkspaceDisplay(ws)).join('\n\n')}`,
                },
            ],
        };
    }

    async getWorkspaceInfo(workspaceId) {
        const query = `
      query($workspaceId: String!) {
        workspace(id: $workspaceId) {
          id
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
                    text: `**Workspace**\n\n` +
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

    async testConnectivity() {
        this.debugLog('🔗 Testing AFFiNE API connectivity...');
        try {
            const testQuery = `
                query {
                    currentUser {
                        id
                        name
                        email
                    }
                }
            `;
            const result = await this.makeGraphQLRequest(testQuery);
            this.debugLog('✅ Connectivity test successful:', { user: result.currentUser });
            return true;
        } catch (error) {
            this.debugLog('❌ Connectivity test failed:', { 
                message: error.message, 
                stack: error.stack,
                apiUrl: this.apiUrl 
            });
            throw new Error(`AFFiNE API connectivity test failed: ${error.message}`);
        }
    }

    async run() {
        try {
            this.debugLog('🚀 Starting MCP server...');
            
            // Test connectivity before starting the server
            await this.testConnectivity();
            
            const transport = new StdioServerTransport();
            await this.server.connect(transport);
            
            this.debugLog('✅ AFFiNE MCP server running on stdio');
            console.error('AFFiNE MCP server running on stdio');
        } catch (error) {
            this.debugLog('❌ Failed to start MCP server:', { 
                message: error.message, 
                stack: error.stack 
            });
            console.error('❌ Failed to start AFFiNE MCP server:', error.message);
            if (this.debug) {
                console.error('Stack trace:', error.stack);
            }
            process.exit(1);
        }
    }
}

// Run the server
const server = new AFFiNEMCPServer();
server.run().catch(console.error);