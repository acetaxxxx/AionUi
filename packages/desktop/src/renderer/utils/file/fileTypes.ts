import type { ChatFileRef } from '@/common/types/chatFile';

export type FileOrFolderItem = {
  path: string; // Absolute path or display-only identity when chatRef is present
  name: string; // 文件名（可能被清理过用于显示）/ File name (may be cleaned for display)
  isFile: boolean; // 是否为文件 / Whether it is a file
  relativePath?: string; // 相对于工作空间的路径（用于发送给 Agent）/ Relative path to workspace (for sending to Agent)
  /**
   * Source-tagged file ref for the send path. When present, the item is sent as
   * this ref and the front-end does NOT build an absolute path. Project files use
   * `{pe_id, relative_path}` and Shared Team uploads use an opaque `upload_id`.
   * When absent (generic uploads, OS-picker `@` mentions), the item is sent as
   * an `upload` ref built from `path`. See {@link ChatFileRef}.
   */
  chatRef?: ChatFileRef;
};
