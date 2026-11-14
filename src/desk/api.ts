import { invoke } from "@tauri-apps/api/core";

export type DeskKind = "document" | "slides";

export interface DeskDocument {
    id: string;
    kind: DeskKind;
    title: string;
    markdown: string;
    updatedAt: number;
}

type MarkdownFile = Pick<DeskDocument, "title" | "markdown">;

export const deskApi = {
    list: () => invoke<DeskDocument[]>("list_desk_documents"),
    create: (kind: DeskKind, file: MarkdownFile) =>
        invoke<DeskDocument>("create_desk_document", { id: crypto.randomUUID(), kind, ...file }),
    update: ({ id, title, markdown }: DeskDocument) =>
        invoke<number>("update_desk_document", { id, title, markdown }),
    remove: (id: string) => invoke<void>("delete_desk_document", { id }),
    importMarkdown: () => invoke<MarkdownFile | null>("import_desk_markdown"),
    exportMarkdown: ({ title, markdown }: MarkdownFile) =>
        invoke<void>("export_desk_markdown", { title, markdown }),
    exportWord: (title: string, parts: { document: string; header: string; footer: string }) =>
        invoke<void>("export_desk_word", { title, ...parts }),
};
