import * as vscode from "vscode";
import init, { COMMANDS } from "./index";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.join(__dirname, "../../../.env") });

const plugin = init({
    autoSync: true,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
});

export function activate(context: vscode.ExtensionContext) {
    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.SAVE_STATE, async () => {
            const description = await vscode.window.showInputBox({
                prompt: "Enter a description for the current state",
                placeHolder: "e.g., Implementing context sync plugin",
            });

            if (!description) return;

            // Get current file content if any
            const editor = vscode.window.activeTextEditor;
            const files: { [path: string]: string } = {};

            if (editor) {
                const document = editor.document;
                files[document.fileName] = document.getText();
            }

            try {
                const stateId = await plugin.saveCurrentState(
                    description,
                    files,
                );
                vscode.window.showInformationMessage(
                    `State saved with ID: ${stateId}`,
                );
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to save state: ${error}`,
                );
            }
        }),
        vscode.commands.registerCommand(COMMANDS.GET_CONTEXT, async () => {
            try {
                const result = await plugin.formatContextForInjection();
                if (result?.formattedContext) {
                    // Show the context in a new editor
                    const doc = await vscode.workspace.openTextDocument({
                        content: result.formattedContext,
                        language: "markdown",
                    });
                    await vscode.window.showTextDocument(doc, {
                        preview: true,
                    });

                    // Also show a notification
                    vscode.window.showInformationMessage(
                        `Found context from ${
                            result.rawContext?.recentContext?.length || 0
                        } recent conversations` +
                            (result.rawContext?.workingState
                                ? " and current working state"
                                : ""),
                    );
                } else {
                    vscode.window.showInformationMessage(
                        "No relevant context found",
                    );
                }
                return result;
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to get context: ${error}`,
                );
                return null;
            }
        }),
        vscode.commands.registerCommand(COMMANDS.TAG_CONVERSATION, async () => {
            const conversationId = await vscode.window.showInputBox({
                prompt: "Enter conversation ID to tag",
            });

            if (!conversationId) return;

            const tagName = await vscode.window.showInputBox({
                prompt: "Enter tag name",
                placeHolder: "e.g., status, priority, category",
            });

            if (!tagName) return;

            const tagValue = await vscode.window.showInputBox({
                prompt: "Enter tag value",
                placeHolder: "e.g., completed, high, bug-fix",
            });

            if (!tagValue) return;

            try {
                await plugin.tagConversation(conversationId, {
                    name: tagName,
                    value: tagValue,
                    timestamp: Date.now(),
                });
                vscode.window.showInformationMessage(
                    "Conversation tagged successfully",
                );
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to tag conversation: ${error}`,
                );
            }
        }),
        vscode.commands.registerCommand(COMMANDS.SEARCH, async () => {
            const query = await vscode.window.showInputBox({
                prompt: "Enter search query",
                placeHolder: "e.g., context sync implementation",
            });

            if (!query) return;

            try {
                const results = await plugin.searchConversations(query);
                if (results?.length) {
                    const items = results.map((conv) => ({
                        label: conv.title,
                        description: `${conv.metadata.type} - ${
                            new Date(conv.created_at).toLocaleString()
                        }`,
                        conversation: conv,
                    }));

                    const selected = await vscode.window.showQuickPick(items, {
                        placeHolder: "Select a conversation to view",
                    });

                    if (selected) {
                        // Show conversation in new editor
                        const doc = await vscode.workspace.openTextDocument({
                            content: JSON.stringify(
                                selected.conversation,
                                null,
                                2,
                            ),
                            language: "json",
                        });
                        await vscode.window.showTextDocument(doc);
                    }
                } else {
                    vscode.window.showInformationMessage(
                        "No conversations found",
                    );
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Search failed: ${error}`);
            }
        }),
    );
}

export function deactivate() {
    // Clean up
    plugin.stopAutoSync();
}
