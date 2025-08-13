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
                    {
                        name: 'publish_document',
                        description: 'Publish a document to make it publicly accessible',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                docId: {
                                    type: 'string',
                                    description: 'Document ID to publish',
                                },
                                workspaceId: {
                                    type: 'string',
                                    description: 'Workspace ID containing the document',
                                },
                                mode: {
                                    type: 'string',
                                    enum: ['Page', 'Edgeless'],
                                    description: 'Publishing mode (default: Page)',
                                    default: 'Page',
                                },
                            },
                            required: ['docId', 'workspaceId'],
                        },
                    },
                    {
                        name: 'unpublish_document',
                        description: 'Revoke public access to a document',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                docId: {
                                    type: 'string',
                                    description: 'Document ID to unpublish',
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
                        name: 'create_comment',
                        description: 'Create a comment on a document',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                docId: {
                                    type: 'string',
                                    description: 'Document ID to comment on',
                                },
                                workspaceId: {
                                    type: 'string',
                                    description: 'Workspace ID containing the document',
                                },
                                content: {
                                    type: 'object',
                                    description: 'Comment content in JSON format',
                                },
                                docMode: {
                                    type: 'string',
                                    enum: ['page', 'edgeless'],
                                    description: 'Document mode',
                                    default: 'page',
                                },
                                docTitle: {
                                    type: 'string',
                                    description: 'Document title',
                                },
                                mentions: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'User IDs to mention in the comment',
                                },
                            },
                            required: ['docId', 'workspaceId', 'content', 'docTitle'],
                        },
                    },
                    {
                        name: 'get_comments',
                        description: 'Get comments for a document',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                docId: {
                                    type: 'string',
                                    description: 'Document ID to get comments for',
                                },
                                workspaceId: {
                                    type: 'string',
                                    description: 'Workspace ID containing the document',
                                },
                                limit: {
                                    type: 'number',
                                    description: 'Maximum number of comments to return (default: 10)',
                                    default: 10,
                                },
                            },
                            required: ['docId', 'workspaceId'],
                        },
                    },
                    {
                        name: 'resolve_comment',
                        description: 'Resolve or unresolve a comment',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                commentId: {
                                    type: 'string',
                                    description: 'Comment ID to resolve/unresolve',
                                },
                                resolved: {
                                    type: 'boolean',
                                    description: 'Whether to resolve (true) or unresolve (false) the comment',
                                },
                            },
                            required: ['commentId', 'resolved'],
                        },
                    },
                    {
                        name: 'delete_comment',
                        description: 'Delete a comment',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                commentId: {
                                    type: 'string',
                                    description: 'Comment ID to delete',
                                },
                            },
                            required: ['commentId'],
                        },
                    },
                    {
                        name: 'advanced_search',
                        description: 'Perform advanced search with boolean queries, field filters, and aggregations',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                workspaceId: {
                                    type: 'string',
                                    description: 'Workspace ID to search in (uses default from AFFINE_WORKSPACE_ID if not provided)',
                                },
                                query: {
                                    type: 'object',
                                    description: 'Search query object with boolean logic',
                                    properties: {
                                        type: {
                                            type: 'string',
                                            enum: ['match', 'boolean', 'all'],
                                            description: 'Query type'
                                        },
                                        match: {
                                            type: 'string',
                                            description: 'Text to match (for match queries)'
                                        },
                                        field: {
                                            type: 'string',
                                            description: 'Field to search in'
                                        },
                                        queries: {
                                            type: 'array',
                                            description: 'Sub-queries for boolean queries'
                                        },
                                        occur: {
                                            type: 'string',
                                            enum: ['must', 'should', 'must_not'],
                                            description: 'Boolean query occurrence'
                                        }
                                    },
                                    required: ['type']
                                },
                                table: {
                                    type: 'string',
                                    enum: ['doc', 'block'],
                                    description: 'Table to search (default: doc)',
                                    default: 'doc'
                                },
                                fields: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Fields to return in results',
                                    default: ['title', 'content', 'id']
                                },
                                limit: {
                                    type: 'number',
                                    description: 'Maximum number of results (default: 10)',
                                    default: 10
                                },
                                highlights: {
                                    type: 'array',
                                    description: 'Fields to highlight in results',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            field: { type: 'string' },
                                            before: { type: 'string' },
                                            end: { type: 'string' }
                                        }
                                    }
                                }
                            },
                            required: ['query']
                        },
                    },
                    {
                        name: 'get_document_history',
                        description: 'Get version history for a document',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                docId: {
                                    type: 'string',
                                    description: 'Document ID to get history for',
                                },
                                workspaceId: {
                                    type: 'string',
                                    description: 'Workspace ID containing the document',
                                },
                                before: {
                                    type: 'string',
                                    description: 'Get history before this timestamp (ISO 8601)',
                                },
                                limit: {
                                    type: 'number',
                                    description: 'Maximum number of history entries (default: 10)',
                                    default: 10,
                                },
                            },
                            required: ['docId', 'workspaceId'],
                        },
                    },
                    {
                        name: 'list_blobs',
                        description: 'List files/blobs in a workspace',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                workspaceId: {
                                    type: 'string',
                                    description: 'Workspace ID to list blobs from',
                                },
                            },
                            required: ['workspaceId'],
                        },
                    },
                    {
                        name: 'delete_blob',
                        description: 'Delete a file/blob from workspace',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                workspaceId: {
                                    type: 'string',
                                    description: 'Workspace ID containing the blob',
                                },
                                blobKey: {
                                    type: 'string',
                                    description: 'Blob key/ID to delete',
                                },
                                permanently: {
                                    type: 'boolean',
                                    description: 'Whether to permanently delete (default: false)',
                                    default: false,
                                },
                            },
                            required: ['workspaceId', 'blobKey'],
                        },
                    },
                    {
                        name: 'list_documents',
                        description: 'List all documents in a workspace with detailed information',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                workspaceId: {
                                    type: 'string',
                                    description: 'Workspace ID to list documents from (uses default from AFFINE_WORKSPACE_ID if not provided)',
                                },
                                limit: {
                                    type: 'number',
                                    description: 'Maximum number of documents to return (default: 50)',
                                    default: 50,
                                },
                                cursor: {
                                    type: 'string',
                                    description: 'Pagination cursor for next page',
                                },
                            },
                            required: [],
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
                    'search_documents': () => this.searchDocuments(args.query, args.workspaceId || this.workspaceId, args.limit),
                    'get_document': () => this.getDocument(args.docId, args.workspaceId || this.workspaceId),
                    'list_workspaces': () => this.listWorkspaces(),
                    'get_workspace_info': () => this.getWorkspaceInfo(args.workspaceId || this.workspaceId),
                    'publish_document': () => this.publishDocument(args.docId, args.workspaceId || this.workspaceId, args.mode),
                    'unpublish_document': () => this.unpublishDocument(args.docId, args.workspaceId || this.workspaceId),
                    'create_comment': () => this.createComment(args.docId, args.workspaceId || this.workspaceId, args.content, args.docMode, args.docTitle, args.mentions),
                    'get_comments': () => this.getComments(args.docId, args.workspaceId || this.workspaceId, args.limit),
                    'resolve_comment': () => this.resolveComment(args.commentId, args.resolved),
                    'delete_comment': () => this.deleteComment(args.commentId),
                    'advanced_search': () => this.advancedSearch(args.workspaceId || this.workspaceId, args.query, args.table, args.fields, args.limit, args.highlights),
                    'get_document_history': () => this.getDocumentHistory(args.docId, args.workspaceId || this.workspaceId, args.before, args.limit),
                    'list_blobs': () => this.listBlobs(args.workspaceId || this.workspaceId),
                    'delete_blob': () => this.deleteBlob(args.workspaceId || this.workspaceId, args.blobKey, args.permanently),
                    'list_documents': () => this.listDocuments(args.workspaceId || this.workspaceId, args.limit, args.cursor)
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
        this.debugLog(`📄 Getting document ${docId} with content in workspace ${workspaceId}`);
        
        // First get document metadata
        const metaQuery = `
            query($workspaceId: String!, $docId: String!) {
                workspace(id: $workspaceId) {
                    doc(docId: $docId) {
                        id
                        title
                        createdAt
                        updatedAt
                        createdBy {
                            id
                            name
                            avatarUrl
                        }
                        lastUpdatedBy {
                            id
                            name
                            avatarUrl
                        }
                        mode
                        public
                        permissions {
                            Doc_Read
                            Doc_Update
                            Doc_Delete
                        }
                    }
                }
            }
        `;

        const metaData = await this.makeGraphQLRequest(metaQuery, { workspaceId, docId });
        const doc = metaData.workspace.doc;

        if (!doc) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `❌ Document not found\n\nDocument ID: ${docId}\nWorkspace ID: ${workspaceId}`,
                    },
                ],
            };
        }

        // Now get document content using search API
        const contentQuery = `
            query($workspaceId: String!, $input: SearchInput!) {
                workspace(id: $workspaceId) {
                    search(input: $input) {
                        nodes {
                            fields
                            highlights
                        }
                        pagination {
                            count
                            hasMore
                        }
                    }
                }
            }
        `;

        // Based on testing, AFFiNE's GraphQL API does not expose document content
        // The search API only returns titles, not actual content
        const docContent = `❌ Document content is not available through AFFiNE's GraphQL API.

The search API only provides document titles, not content. AFFiNE likely uses:
• WebSocket connections for real-time document editing
• REST APIs for content access 
• Binary protocols for performance

To access document content, you would need:
• Direct access to AFFiNE's web interface
• Alternative APIs (if available)
• Export functionality (if implemented)

Available through this MCP server:
• Document metadata (shown above)
• Comments via 'get_comments'
• Version history via 'get_document_history'  
• Search snippets via 'search_documents'`;

        // Handle title display
        const displayTitle = doc.title || `Document ${doc.id.substring(0, 8)}`;

        return {
            content: [
                {
                    type: 'text',
                    text: `📄 ${displayTitle}\n\n` +
                        `ID: ${doc.id}\n` +
                        `Mode: ${doc.mode}\n` +
                        `Public: ${doc.public ? 'Yes' : 'No'}\n` +
                        `Created: ${new Date(doc.createdAt).toLocaleString()}\n` +
                        `Updated: ${new Date(doc.updatedAt).toLocaleString()}\n` +
                        `Created by: ${doc.createdBy?.name || 'Unknown'}\n` +
                        `Last updated by: ${doc.lastUpdatedBy?.name || 'Unknown'}\n` +
                        `Permissions: Read: ${doc.permissions?.Doc_Read ? '✅' : '❌'}, Update: ${doc.permissions?.Doc_Update ? '✅' : '❌'}, Delete: ${doc.permissions?.Doc_Delete ? '✅' : '❌'}\n` +
                        `Title set: ${doc.title ? 'Yes' : 'No (common in AFFiNE)'}\n\n` +
                        `--- DOCUMENT CONTENT ---\n\n${docContent}`,
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

    async publishDocument(docId, workspaceId, mode = 'Page') {
        this.debugLog(`📝 Publishing document ${docId} in workspace ${workspaceId} with mode ${mode}`);
        
        const mutation = `
            mutation($docId: String!, $workspaceId: String!, $mode: PublicDocMode!) {
                publishDoc(docId: $docId, workspaceId: $workspaceId, mode: $mode) {
                    id
                    title
                    public
                    mode
                    permissions {
                        Doc_Read
                        Doc_Update
                    }
                }
            }
        `;

        try {
            const data = await this.makeGraphQLRequest(mutation, { 
                docId, 
                workspaceId, 
                mode 
            });
            
            const doc = data.publishDoc;
            return {
                content: [
                    {
                        type: 'text',
                        text: `✅ **Document "${doc.title}" published successfully**\n\n` +
                            `**Document ID:** ${doc.id}\n` +
                            `**Mode:** ${doc.mode}\n` +
                            `**Public:** ${doc.public ? 'Yes' : 'No'}\n` +
                            `**Permissions:** Read: ${doc.permissions.Doc_Read ? 'Yes' : 'No'}, Update: ${doc.permissions.Doc_Update ? 'Yes' : 'No'}\n\n` +
                            `The document is now publicly accessible.`,
                    },
                ],
            };
        } catch (error) {
            this.debugLog(`❌ Failed to publish document:`, error);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to publish document: ${error.message}`
            );
        }
    }

    async unpublishDocument(docId, workspaceId) {
        this.debugLog(`🔒 Unpublishing document ${docId} in workspace ${workspaceId}`);
        
        const mutation = `
            mutation($docId: String!, $workspaceId: String!) {
                revokePublicDoc(docId: $docId, workspaceId: $workspaceId) {
                    id
                    title
                    public
                    permissions {
                        Doc_Read
                        Doc_Update
                    }
                }
            }
        `;

        try {
            const data = await this.makeGraphQLRequest(mutation, { 
                docId, 
                workspaceId 
            });
            
            const doc = data.revokePublicDoc;
            return {
                content: [
                    {
                        type: 'text',
                        text: `🔒 **Document "${doc.title}" unpublished successfully**\n\n` +
                            `**Document ID:** ${doc.id}\n` +
                            `**Public:** ${doc.public ? 'Yes' : 'No'}\n` +
                            `**Permissions:** Read: ${doc.permissions.Doc_Read ? 'Yes' : 'No'}, Update: ${doc.permissions.Doc_Update ? 'Yes' : 'No'}\n\n` +
                            `The document is no longer publicly accessible.`,
                    },
                ],
            };
        } catch (error) {
            this.debugLog(`❌ Failed to unpublish document:`, error);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to unpublish document: ${error.message}`
            );
        }
    }

    async createComment(docId, workspaceId, content, docMode = 'page', docTitle, mentions = []) {
        this.debugLog(`💬 Creating comment on document ${docId} in workspace ${workspaceId}`);
        
        const mutation = `
            mutation($input: CommentCreateInput!) {
                createComment(input: $input) {
                    id
                    content
                    createdAt
                    resolved
                    user {
                        id
                        name
                        avatarUrl
                    }
                    replies {
                        id
                        content
                        createdAt
                        user {
                            id
                            name
                            avatarUrl
                        }
                    }
                }
            }
        `;

        try {
            const data = await this.makeGraphQLRequest(mutation, {
                input: {
                    docId,
                    workspaceId,
                    content,
                    docMode,
                    docTitle,
                    mentions: mentions || []
                }
            });
            
            const comment = data.createComment;
            return {
                content: [
                    {
                        type: 'text',
                        text: `💬 **Comment created successfully**\n\n` +
                            `**Comment ID:** ${comment.id}\n` +
                            `**Author:** ${comment.user.name}\n` +
                            `**Created:** ${new Date(comment.createdAt).toLocaleString()}\n` +
                            `**Resolved:** ${comment.resolved ? 'Yes' : 'No'}\n` +
                            `**Replies:** ${comment.replies.length}\n\n` +
                            `**Content:** ${JSON.stringify(comment.content, null, 2)}`,
                    },
                ],
            };
        } catch (error) {
            this.debugLog(`❌ Failed to create comment:`, error);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to create comment: ${error.message}`
            );
        }
    }

    async getComments(docId, workspaceId, limit = 10) {
        this.debugLog(`📋 Getting comments for document ${docId} in workspace ${workspaceId}`);
        
        const query = `
            query($workspaceId: String!, $docId: String!, $pagination: PaginationInput) {
                workspace(id: $workspaceId) {
                    comments(docId: $docId, pagination: $pagination) {
                        edges {
                            node {
                                id
                                content
                                createdAt
                                updatedAt
                                resolved
                                user {
                                    id
                                    name
                                    avatarUrl
                                }
                                replies {
                                    id
                                    content
                                    createdAt
                                    user {
                                        id
                                        name
                                        avatarUrl
                                    }
                                }
                            }
                        }
                        totalCount
                        pageInfo {
                            hasNextPage
                            hasPreviousPage
                        }
                    }
                }
            }
        `;

        try {
            const data = await this.makeGraphQLRequest(query, {
                workspaceId,
                docId,
                pagination: {
                    first: limit
                }
            });
            
            const comments = data.workspace.comments;
            const commentList = comments.edges.map(edge => edge.node);
            
            if (commentList.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `📋 **No comments found for this document**\n\nDocument ID: ${docId}`,
                        },
                    ],
                };
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `📋 **Comments for Document (${comments.totalCount} total)**\n\n` +
                            commentList.map(comment => 
                                `**Comment ${comment.id}** by ${comment.user.name}\n` +
                                `Created: ${new Date(comment.createdAt).toLocaleString()}\n` +
                                `Status: ${comment.resolved ? '✅ Resolved' : '🔄 Open'}\n` +
                                `Replies: ${comment.replies.length}\n` +
                                `Content: ${JSON.stringify(comment.content)}\n`
                            ).join('\n---\n\n'),
                    },
                ],
            };
        } catch (error) {
            this.debugLog(`❌ Failed to get comments:`, error);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get comments: ${error.message}`
            );
        }
    }

    async resolveComment(commentId, resolved) {
        this.debugLog(`${resolved ? '✅' : '🔄'} ${resolved ? 'Resolving' : 'Unresolving'} comment ${commentId}`);
        
        const mutation = `
            mutation($input: CommentResolveInput!) {
                resolveComment(input: $input)
            }
        `;

        try {
            const data = await this.makeGraphQLRequest(mutation, {
                input: {
                    id: commentId,
                    resolved
                }
            });
            
            return {
                content: [
                    {
                        type: 'text',
                        text: `${resolved ? '✅' : '🔄'} **Comment ${resolved ? 'resolved' : 'unresolved'} successfully**\n\n` +
                            `**Comment ID:** ${commentId}\n` +
                            `**Status:** ${resolved ? 'Resolved' : 'Open'}`,
                    },
                ],
            };
        } catch (error) {
            this.debugLog(`❌ Failed to ${resolved ? 'resolve' : 'unresolve'} comment:`, error);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to ${resolved ? 'resolve' : 'unresolve'} comment: ${error.message}`
            );
        }
    }

    async deleteComment(commentId) {
        this.debugLog(`🗑️ Deleting comment ${commentId}`);
        
        const mutation = `
            mutation($id: String!) {
                deleteComment(id: $id)
            }
        `;

        try {
            const data = await this.makeGraphQLRequest(mutation, {
                id: commentId
            });
            
            return {
                content: [
                    {
                        type: 'text',
                        text: `🗑️ **Comment deleted successfully**\n\n` +
                            `**Comment ID:** ${commentId}\n` +
                            `The comment has been permanently removed.`,
                    },
                ],
            };
        } catch (error) {
            this.debugLog(`❌ Failed to delete comment:`, error);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to delete comment: ${error.message}`
            );
        }
    }

    async advancedSearch(workspaceId, query, table = 'doc', fields = ['title', 'content', 'id'], limit = 10, highlights = []) {
        this.debugLog(`🔍 Performing advanced search in workspace ${workspaceId}`, { query, table, fields, limit });
        
        const searchQuery = `
            query($workspaceId: String!, $input: SearchInput!) {
                workspace(id: $workspaceId) {
                    search(input: $input) {
                        nodes {
                            fields
                            highlights
                        }
                        pagination {
                            count
                            hasMore
                            nextCursor
                        }
                    }
                }
            }
        `;

        try {
            const searchInput = {
                query,
                table,
                options: {
                    fields,
                    pagination: {
                        limit
                    }
                }
            };

            // Add highlights if provided
            if (highlights && highlights.length > 0) {
                searchInput.options.highlights = highlights;
            }

            const data = await this.makeGraphQLRequest(searchQuery, {
                workspaceId,
                input: searchInput
            });
            
            const searchResults = data.workspace.search;
            const results = searchResults.nodes;
            
            if (results.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `🔍 **No results found**\n\nQuery: ${JSON.stringify(query, null, 2)}\nTable: ${table}\nFields: ${fields.join(', ')}`,
                        },
                    ],
                };
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `🔍 **Advanced Search Results (${searchResults.pagination.count} found)**\n\n` +
                            `**Query:** ${JSON.stringify(query, null, 2)}\n` +
                            `**Table:** ${table}\n` +
                            `**Fields:** ${fields.join(', ')}\n\n` +
                            `**Results:**\n\n` +
                            results.map((result, index) => {
                                let resultText = `**Result ${index + 1}:**\n`;
                                
                                // Display fields
                                if (result.fields) {
                                    Object.entries(result.fields).forEach(([key, value]) => {
                                        resultText += `• **${key}:** ${value}\n`;
                                    });
                                }
                                
                                // Display highlights if available
                                if (result.highlights && Object.keys(result.highlights).length > 0) {
                                    resultText += `• **Highlights:**\n`;
                                    Object.entries(result.highlights).forEach(([key, value]) => {
                                        resultText += `  - ${key}: ${value}\n`;
                                    });
                                }
                                
                                return resultText;
                            }).join('\n---\n\n') +
                            `\n**Pagination:** ${searchResults.pagination.hasMore ? 'More results available' : 'All results shown'}`,
                    },
                ],
            };
        } catch (error) {
            this.debugLog(`❌ Advanced search failed:`, error);
            throw new McpError(
                ErrorCode.InternalError,
                `Advanced search failed: ${error.message}`
            );
        }
    }

    async getDocumentHistory(docId, workspaceId, before = null, limit = 10) {
        this.debugLog(`📜 Getting document history for ${docId} in workspace ${workspaceId}`);
        
        const query = `
            query($workspaceId: String!, $guid: String!, $before: DateTime, $take: Int) {
                workspace(id: $workspaceId) {
                    histories(guid: $guid, before: $before, take: $take) {
                        id
                        timestamp
                        editor {
                            name
                            avatarUrl
                        }
                        workspaceId
                    }
                }
            }
        `;

        try {
            const variables = {
                workspaceId,
                guid: docId,
                take: limit
            };

            if (before) {
                variables.before = before;
            }

            const data = await this.makeGraphQLRequest(query, variables);
            
            const histories = data.workspace.histories;
            
            if (!histories || histories.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `📜 **No history found for document**\n\nDocument ID: ${docId}\nWorkspace ID: ${workspaceId}`,
                        },
                    ],
                };
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `📜 **Document History (${histories.length} entries)**\n\n` +
                            `**Document ID:** ${docId}\n` +
                            `**Workspace ID:** ${workspaceId}\n\n` +
                            `**History Entries:**\n\n` +
                            histories.map((history, index) => {
                                const timestamp = new Date(history.timestamp).toLocaleString();
                                const editor = history.editor ? history.editor.name : 'Unknown';
                                
                                return `**${index + 1}. Version ${history.id}**\n` +
                                    `• **Timestamp:** ${timestamp}\n` +
                                    `• **Editor:** ${editor}\n` +
                                    `• **Workspace:** ${history.workspaceId}`;
                            }).join('\n\n---\n\n'),
                    },
                ],
            };
        } catch (error) {
            this.debugLog(`❌ Failed to get document history:`, error);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to get document history: ${error.message}`
            );
        }
    }

    async listBlobs(workspaceId) {
        this.debugLog(`📁 Listing blobs in workspace ${workspaceId}`);
        
        const query = `
            query($workspaceId: String!) {
                workspace(id: $workspaceId) {
                    blobs {
                        key
                        mime
                        size
                        createdAt
                    }
                    blobsSize
                }
            }
        `;

        try {
            const data = await this.makeGraphQLRequest(query, { workspaceId });
            
            const workspace = data.workspace;
            const blobs = workspace.blobs;
            
            if (!blobs || blobs.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `📁 **No files found in workspace**\n\nWorkspace ID: ${workspaceId}\nTotal size: ${workspace.blobsSize} bytes`,
                        },
                    ],
                };
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `📁 **Files in Workspace (${blobs.length} files)**\n\n` +
                            `**Workspace ID:** ${workspaceId}\n` +
                            `**Total Size:** ${this.formatFileSize(workspace.blobsSize)}\n\n` +
                            `**Files:**\n\n` +
                            blobs.map((blob, index) => {
                                const createdDate = new Date(blob.createdAt).toLocaleString();
                                const fileSize = this.formatFileSize(blob.size);
                                
                                return `**${index + 1}. ${blob.key}**\n` +
                                    `• **Type:** ${blob.mime}\n` +
                                    `• **Size:** ${fileSize}\n` +
                                    `• **Created:** ${createdDate}`;
                            }).join('\n\n---\n\n'),
                    },
                ],
            };
        } catch (error) {
            this.debugLog(`❌ Failed to list blobs:`, error);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to list blobs: ${error.message}`
            );
        }
    }

    async deleteBlob(workspaceId, blobKey, permanently = false) {
        this.debugLog(`🗑️ Deleting blob ${blobKey} from workspace ${workspaceId} (permanently: ${permanently})`);
        
        const mutation = `
            mutation($workspaceId: String!, $key: String, $permanently: Boolean!) {
                deleteBlob(workspaceId: $workspaceId, key: $key, permanently: $permanently)
            }
        `;

        try {
            const data = await this.makeGraphQLRequest(mutation, {
                workspaceId,
                key: blobKey,
                permanently
            });
            
            return {
                content: [
                    {
                        type: 'text',
                        text: `🗑️ **File deleted successfully**\n\n` +
                            `**File Key:** ${blobKey}\n` +
                            `**Workspace ID:** ${workspaceId}\n` +
                            `**Permanently Deleted:** ${permanently ? 'Yes' : 'No'}\n\n` +
                            `${permanently ? 'The file has been permanently removed and cannot be recovered.' : 'The file has been moved to trash and can be recovered.'}`,
                    },
                ],
            };
        } catch (error) {
            this.debugLog(`❌ Failed to delete blob:`, error);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to delete blob: ${error.message}`
            );
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async listDocuments(workspaceId, limit = 50, cursor = null) {
        this.debugLog(`📄 Listing documents in workspace ${workspaceId} (limit: ${limit})`);
        
        const query = `
            query($workspaceId: String!, $pagination: PaginationInput!) {
                workspace(id: $workspaceId) {
                    docs(pagination: $pagination) {
                        edges {
                            cursor
                            node {
                                id
                                title
                                createdAt
                                updatedAt
                                public
                                mode
                                summary
                                createdBy {
                                    id
                                    name
                                    avatarUrl
                                }
                                lastUpdatedBy {
                                    id
                                    name
                                    avatarUrl
                                }
                                permissions {
                                    Doc_Read
                                    Doc_Update
                                    Doc_Delete
                                }
                                meta {
                                    createdAt
                                    updatedAt
                                    createdBy {
                                        name
                                    }
                                    updatedBy {
                                        name
                                    }
                                }
                            }
                        }
                        pageInfo {
                            hasNextPage
                            hasPreviousPage
                            startCursor
                            endCursor
                        }
                        totalCount
                    }
                }
            }
        `;

        try {
            const pagination = {
                first: limit
            };

            if (cursor) {
                pagination.after = cursor;
            }

            const data = await this.makeGraphQLRequest(query, {
                workspaceId,
                pagination
            });
            
            const docsResult = data.workspace.docs;
            const documents = docsResult.edges.map(edge => edge.node);
            
            if (documents.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `📄 **No documents found in workspace**\n\nWorkspace ID: ${workspaceId}`,
                        },
                    ],
                };
            }

            return {
                content: [
                    {
                        type: 'text',
                        text: `📄 Documents in Workspace (${docsResult.totalCount} total, showing ${documents.length})\n\n` +
                            `Workspace ID: ${workspaceId}\n` +
                            `Pagination: ${docsResult.pageInfo.hasNextPage ? 'More available' : 'All shown'}\n\n` +
                            documents.map((doc, index) => {
                                const createdDate = new Date(doc.createdAt || doc.meta?.createdAt).toLocaleString();
                                const updatedDate = new Date(doc.updatedAt || doc.meta?.updatedAt).toLocaleString();
                                const creator = doc.createdBy?.name || doc.meta?.createdBy?.name || 'Unknown';
                                const lastEditor = doc.lastUpdatedBy?.name || doc.meta?.updatedBy?.name || 'Unknown';
                                
                                // Handle title - AFFiNE documents often have null titles
                                let displayTitle;
                                if (doc.title === null || doc.title === undefined) {
                                    displayTitle = `Document ${doc.id.substring(0, 8)}`;
                                } else if (doc.title.trim() === '') {
                                    displayTitle = `Document ${doc.id.substring(0, 8)} (Empty Title)`;
                                } else {
                                    displayTitle = doc.title;
                                }
                                
                                return `${index + 1}. ${displayTitle}\n` +
                                    `   • ID: ${doc.id}\n` +
                                    `   • Mode: ${doc.mode}\n` +
                                    `   • Public: ${doc.public ? 'Yes' : 'No'}\n` +
                                    `   • Created: ${createdDate} by ${creator}\n` +
                                    `   • Updated: ${updatedDate} by ${lastEditor}\n` +
                                    `   • Permissions: Read: ${doc.permissions.Doc_Read ? '✅' : '❌'}, Update: ${doc.permissions.Doc_Update ? '✅' : '❌'}, Delete: ${doc.permissions.Doc_Delete ? '✅' : '❌'}\n` +
                                    (doc.summary ? `   • Summary: ${doc.summary}\n` : '') +
                                    `   • Note: ${doc.title ? 'Has title' : 'No title set (common in AFFiNE)'}`;
                            }).join('\n\n') +
                            (docsResult.pageInfo.hasNextPage ? 
                                `\n\nNext Page Cursor: ${docsResult.pageInfo.endCursor}` : ''),
                    },
                ],
            };
        } catch (error) {
            this.debugLog(`❌ Failed to list documents:`, error);
            throw new McpError(
                ErrorCode.InternalError,
                `Failed to list documents: ${error.message}`
            );
        }
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