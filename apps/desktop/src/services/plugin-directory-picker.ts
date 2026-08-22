import { open } from "@tauri-apps/plugin-dialog";

import { isTauriEnvironment } from "./desktop-backend-request.js";

export const pickPluginDirectory = async (): Promise<string | null> => {
  if (!isTauriEnvironment()) {
    throw new Error(
      "Directory selection is only available inside the Tauri desktop runtime."
    );
  }

  const selected = await open({
    directory: true,
    multiple: false,
    title: "Select plugin package directory"
  });

  if (selected === null) {
    return null;
  }

  if (Array.isArray(selected)) {
    return selected[0] ?? null;
  }

  return selected;
};
