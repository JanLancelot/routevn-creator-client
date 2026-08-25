const scanObjectForIds = (obj, targetIdSet) => {
  if (!obj || typeof obj !== "object") {
    return false;
  }

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === "string") {
      if (targetIdSet.has(val)) {
        return true;
      }
      if (val.includes("${")) {
        for (const id of targetIdSet) {
          if (val.includes(id)) {
            return true;
          }
        }
      }
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string" && targetIdSet.has(item)) {
          return true;
        }
        if (
          item &&
          typeof item === "object" &&
          scanObjectForIds(item, targetIdSet)
        ) {
          return true;
        }
      }
    } else if (val && typeof val === "object") {
      if (scanObjectForIds(val, targetIdSet)) {
        return true;
      }
    }
  }

  return false;
};

export const findResourceSceneUsage = ({
  scenes,
  itemId,
  additionalItemIds = [],
} = {}) => {
  if (!itemId || !scenes?.items) {
    return [];
  }

  const targetIdSet = new Set([itemId, ...additionalItemIds]);
  const matchingScenes = [];

  for (const scene of Object.values(scenes.items)) {
    if (!scene || scene.type === "folder") {
      continue;
    }

    const sections = scene.sections?.items ?? scene.sections;
    if (scanObjectForIds(sections, targetIdSet)) {
      matchingScenes.push({
        id: scene.id,
        name: scene.name || "Untitled Scene",
      });
    }
  }

  return matchingScenes;
};

export const formatResourceSceneUsage = (scenes = [], copy = {}) => {
  if (scenes.length === 0) {
    return copy.usedInNone ?? "None";
  }

  const names = scenes.map((scene) => scene.name);
  if (names.length <= 2) {
    return names.join(", ");
  }

  return `${names.slice(0, 2).join(", ")}, +${names.length - 2} more`;
};

export const createUsedInDetailField = ({
  scenes,
  itemId,
  additionalItemIds,
  copy = {},
} = {}) => {
  const matchingScenes = findResourceSceneUsage({
    scenes,
    itemId,
    additionalItemIds,
  });

  return {
    type: "text",
    label: copy.usedInLabel ?? "Used In",
    value: formatResourceSceneUsage(matchingScenes, copy),
  };
};
