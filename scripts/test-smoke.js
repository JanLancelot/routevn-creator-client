import assert from "node:assert/strict";

import { createCommandEnvelope } from "../src/deps/services/shared/collab/commandEnvelope.js";
import {
  mainScenePartitionFor,
  scenePartitionFor,
} from "../src/deps/services/shared/collab/partitions.js";
import {
  applyCommandToRepository,
  applyCommandToRepositoryState,
  createProjectRepository,
} from "../src/deps/services/shared/projectRepository.js";
import {
  buildLayoutRenderElements,
  extractFileIdsFromRenderState,
  prepareRenderStateKeyboardForGraphics,
} from "../src/internal/project/layout.js";
import {
  buildFilteredStateForExport,
  collectUsedResourcesForExport,
  constructProjectData,
  projectRepositoryStateToDomainState,
} from "../src/internal/project/projection.js";
import {
  BUNDLE_APP_NAME,
  createBundle,
  createBundleInstructions,
  createBundleRangeReader,
  parseBundle,
} from "../src/deps/services/shared/projectExportService.js";
import { toHierarchyStructure } from "../src/internal/project/tree.js";
import {
  calculateSceneReadingTimeMinutes,
  formatSceneTextStatsLabel,
  getSceneReadingSpeed,
} from "../src/internal/ui/sceneTextStats.js";

const projectId = "proj-smoke-001";
const actor = {
  userId: "user-1",
  clientId: "client-1",
};
const scene1MainPartition = mainScenePartitionFor("scene-1");
const scene1Partition = scenePartitionFor("scene-1");

const createRepositoryStoreStub = () => {
  const events = [];
  const checkpoints = new Map();

  return {
    async appendEvent(event) {
      events.push(structuredClone(event));
    },
    async loadMaterializedViewCheckpoint({ viewName, partition }) {
      return checkpoints.get(`${viewName}:${partition}`);
    },
    async loadMaterializedViewCheckpoints({ viewName, partitions = [] }) {
      return partitions.flatMap((partition) => {
        const checkpoint = checkpoints.get(`${viewName}:${partition}`);
        return checkpoint ? [structuredClone(checkpoint)] : [];
      });
    },
    async saveMaterializedViewCheckpoint(checkpoint) {
      checkpoints.set(
        `${checkpoint.viewName}:${checkpoint.partition}`,
        structuredClone(checkpoint),
      );
    },
    async saveMaterializedViewCheckpoints({ checkpoints: nextCheckpoints }) {
      for (const checkpoint of nextCheckpoints) {
        checkpoints.set(
          `${checkpoint.viewName}:${checkpoint.partition}`,
          structuredClone(checkpoint),
        );
      }
    },
    async deleteMaterializedViewCheckpoint({ viewName, partition }) {
      checkpoints.delete(`${viewName}:${partition}`);
    },
    _debug: {
      getEvents() {
        return events.map((event) => structuredClone(event));
      },
    },
  };
};

const makeEnvelope = ({ type, payload, partition = "m", clientTs }) => {
  return createCommandEnvelope({
    id: `${type}-${clientTs}`,
    projectId,
    partition,
    type,
    payload,
    actor,
    clientTs,
  });
};

const stripEmptyChildren = (nodes = []) =>
  nodes.map((node) => {
    const children = stripEmptyChildren(node.children || []);
    return children.length > 0 ? { id: node.id, children } : { id: node.id };
  });

const parseBundleInstructions = async (bundle) => {
  const parsedBundle = await parseBundle(bundle);
  return parsedBundle.instructions;
};

const createRangeFetch =
  (bytes) =>
  async (_url, init = {}) => {
    assert.equal(init.headers?.Range, undefined);
    const range = init.headers?.range ?? "";
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    assert.ok(match, "range fetch must receive a byte range");

    const start = Number(match[1]);
    const end = Number(match[2]);
    const body = bytes.slice(start, end + 1);

    return new Response(body, {
      status: 206,
      headers: {
        "content-range": `bytes ${start}-${end}/${bytes.byteLength}`,
      },
    });
  };

const createFullBundleFetch = (bytes) => {
  let requestCount = 0;

  const fetchBundle = async () => {
    requestCount += 1;

    return new Response(bytes, {
      status: 200,
      headers: {
        "content-length": String(bytes.byteLength),
      },
    });
  };

  fetchBundle.getRequestCount = () => requestCount;

  return fetchBundle;
};

const store = createRepositoryStoreStub();
const repository = await createProjectRepository({
  projectId,
  store,
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: scene1MainPartition,
    clientTs: 1000,
    type: "scene.create",
    payload: {
      sceneId: "scene-1",
      data: {
        name: "Opening",
      },
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: "m",
    clientTs: 1010,
    type: "story.update",
    payload: {
      data: {
        initialSceneId: "scene-1",
      },
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: scene1MainPartition,
    clientTs: 1020,
    type: "section.create",
    payload: {
      sceneId: "scene-1",
      sectionId: "section-1",
      data: {
        name: "Main",
      },
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: scene1Partition,
    clientTs: 1030,
    type: "line.create",
    payload: {
      sectionId: "section-1",
      lines: [
        {
          lineId: "line-1",
          data: {
            actions: {
              narration: "hello",
            },
          },
        },
        {
          lineId: "line-2",
          data: {
            actions: {
              narration: "world",
            },
          },
        },
      ],
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: scene1MainPartition,
    clientTs: 1040,
    type: "section.create",
    payload: {
      sceneId: "scene-1",
      sectionId: "section-2",
      data: {
        name: "Branch",
      },
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: scene1Partition,
    clientTs: 1077,
    type: "line.update_actions",
    payload: {
      lineId: "line-1",
      data: {
        narration: "hello",
        control: {
          resourceId: "layout-main",
          resourceType: "control",
        },
      },
      replace: false,
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: "m",
    clientTs: 1045,
    type: "file.create",
    payload: {
      fileId: "hero.png",
      data: {
        type: "image",
        mimeType: "image/png",
        size: 1024,
        sha256: "sha256-hero",
      },
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: "m",
    clientTs: 1050,
    type: "image.create",
    payload: {
      imageId: "image-hero",
      data: {
        type: "image",
        name: "Hero",
        fileId: "hero.png",
        width: 1280,
        height: 720,
      },
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: "m",
    clientTs: 1060,
    type: "control.create",
    payload: {
      controlId: "layout-main",
      data: {
        type: "control",
        name: "Main Control",
        elements: {
          items: {},
          tree: [],
        },
      },
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: "m",
    clientTs: 1070,
    type: "control.element.create",
    payload: {
      controlId: "layout-main",
      elementId: "sprite-root",
      data: {
        type: "sprite",
        name: "Hero Sprite",
        imageId: "image-hero",
      },
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: "m",
    clientTs: 1075,
    type: "control.update",
    payload: {
      controlId: "layout-main",
      data: {
        keyboard: {
          enter: {
            payload: {
              actions: {
                nextLine: {},
              },
            },
          },
        },
      },
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: "m",
    clientTs: 1080,
    type: "character.create",
    payload: {
      characterId: "character-hero",
      data: {
        type: "character",
        name: "Hero",
        description: "Lead character",
        sprites: {
          tree: [
            {
              id: "default-sprites",
              children: [],
            },
          ],
          items: {
            "default-sprites": {
              id: "default-sprites",
              type: "folder",
              name: "Default Sprites",
            },
          },
        },
      },
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: "m",
    clientTs: 1090,
    type: "character.sprite.create",
    payload: {
      characterId: "character-hero",
      spriteId: "expressions",
      data: {
        type: "folder",
        name: "Expressions",
      },
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: "m",
    clientTs: 1095,
    type: "file.create",
    payload: {
      fileId: "hero-smile.png",
      data: {
        type: "image",
        mimeType: "image/png",
        size: 2048,
        sha256: "sha256-hero-smile",
      },
    },
  }),
});

await applyCommandToRepository({
  repository,
  projectId,
  command: makeEnvelope({
    partition: "m",
    clientTs: 1100,
    type: "character.sprite.create",
    payload: {
      characterId: "character-hero",
      spriteId: "sprite-smile",
      parentId: "expressions",
      data: {
        type: "image",
        name: "Smile",
        fileId: "hero-smile.png",
      },
    },
  }),
});

const sceneOverviews = await repository.loadSceneOverviews({
  sceneIds: ["scene-1"],
});
const repositoryState = repository.getState();
const scene1Overview = sceneOverviews["scene-1"];

assert.deepEqual(scene1Overview, {
  sceneId: "scene-1",
  name: "Opening",
  position: {
    x: 0,
    y: 0,
  },
  outgoingSceneIds: [],
  sections: [
    {
      sectionId: "section-1",
      name: "Main",
      outgoingSceneIds: [],
      isDeadEnd: true,
    },
    {
      sectionId: "section-2",
      name: "Branch",
      outgoingSceneIds: [],
      isDeadEnd: true,
    },
  ],
});

assert.equal(repositoryState.story.initialSceneId, "scene-1");
assert.deepEqual(stripEmptyChildren(repositoryState.scenes.tree), [
  { id: "scene-1" },
]);
assert.deepEqual(
  stripEmptyChildren(repositoryState.scenes.items["scene-1"].sections.tree),
  [{ id: "section-1" }, { id: "section-2" }],
);
assert.deepEqual(
  stripEmptyChildren(
    repositoryState.scenes.items["scene-1"].sections.items["section-1"].lines
      .tree,
  ),
  [{ id: "line-1" }, { id: "line-2" }],
);

const beforeInvalidApply = structuredClone(repositoryState);
const invalidLineInsert = applyCommandToRepositoryState({
  repositoryState,
  projectId,
  command: {
    type: "line.create",
    payload: {
      sectionId: "section-2",
      position: "after",
      positionTargetId: "line-1",
      lines: [
        {
          lineId: "line-3",
          data: {
            actions: {},
          },
        },
      ],
    },
  },
});

assert.equal(invalidLineInsert.valid, false);
assert.equal(
  invalidLineInsert.error.message,
  "payload.positionTargetId must reference a line in the target section",
);
assert.deepEqual(repository.getState(), beforeInvalidApply);
assert.deepEqual(repositoryState.controls.items["layout-main"].keyboard, {
  enter: {
    payload: {
      actions: {
        nextLine: {},
      },
    },
  },
});

const layoutHierarchy = toHierarchyStructure(
  repositoryState.controls.items["layout-main"].elements,
);
assert.deepEqual(
  layoutHierarchy.map((node) => node.id),
  ["sprite-root"],
);

const spriteHierarchy = toHierarchyStructure(
  repositoryState.characters.items["character-hero"].sprites,
);
assert.deepEqual(
  spriteHierarchy.map((node) => ({
    id: node.id,
    children: (node.children ?? []).map((child) => child.id),
  })),
  [
    {
      id: "default-sprites",
      children: [],
    },
    {
      id: "expressions",
      children: ["sprite-smile"],
    },
  ],
);

const renderState = buildLayoutRenderElements(
  layoutHierarchy,
  repositoryState.images.items,
  repositoryState.textStyles,
  repositoryState.colors,
  repositoryState.fonts,
);
const renderFileIds = extractFileIdsFromRenderState(renderState);
assert.deepEqual(renderFileIds, [
  {
    type: "image/png",
    url: "hero.png",
  },
]);

const domainState = projectRepositoryStateToDomainState({
  repositoryState,
  projectId,
});
const exportUsage = collectUsedResourcesForExport(repositoryState);
const filteredExportState = buildFilteredStateForExport(
  repositoryState,
  exportUsage,
);
const projectData = constructProjectData(repositoryState, {
  initialSceneId: "scene-1",
});
const exportProjectData = constructProjectData(filteredExportState);
const bundlePayload = createBundleInstructions({
  projectData: exportProjectData,
  bundler: {
    appVersion: "1.0.0-rc2",
  },
  project: {
    namespace: "project-namespace-1",
  },
});
const bundle = await createBundle(bundlePayload);
const bundleInstructions = await parseBundleInstructions(bundle);
const rangeBundle = await createBundle(bundlePayload, {
  "hero.png": {
    mime: "image/png",
    buffer: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  },
});
const rangeReader = await createBundleRangeReader({
  url: "package.bin",
  fetchFn: createRangeFetch(rangeBundle),
});
const rangeInstructions = await rangeReader.readInstructions();
const rangeAsset = await rangeReader.readAsset("hero.png");
const fullBundleFetch = createFullBundleFetch(rangeBundle);
const fullResponseReader = await createBundleRangeReader({
  url: "package.bin",
  fetchFn: fullBundleFetch,
});
const fullResponseInstructions = await fullResponseReader.readInstructions();
const fullResponseAsset = await fullResponseReader.readAsset("hero.png");
assert.equal(domainState.story.initialSceneId, "scene-1");
assert.deepEqual(domainState.scenes["scene-1"].sectionIds, [
  "section-1",
  "section-2",
]);
assert.deepEqual(domainState.sections["section-1"].lineIds, [
  "line-1",
  "line-2",
]);
assert.equal(
  domainState.characters.items["character-hero"].sprites.items["sprite-smile"]
    .fileId,
  "hero-smile.png",
);
assert.deepEqual(domainState.controls.items["layout-main"].keyboard, {
  enter: {
    payload: {
      actions: {
        nextLine: {},
      },
    },
  },
});
assert.equal(projectData.resources.controls["layout-main"].id, "layout-main");
assert.equal(
  projectData.resources.controls["layout-main"].name,
  "Main Control",
);
assert.equal(exportProjectData.story.initialSceneId, "scene-1");
assert.equal(
  exportProjectData.story.scenes["scene-1"].initialSectionId,
  "section-1",
);
assert.deepEqual(
  exportProjectData.story.scenes["scene-1"].sections["section-1"].lines.map(
    (line) => line.id,
  ),
  ["line-1", "line-2"],
);
assert.equal(bundleInstructions.projectData.story.initialSceneId, "scene-1");
assert.equal(
  bundleInstructions.projectData.story.scenes["scene-1"].initialSectionId,
  "section-1",
);
assert.equal(
  bundleInstructions.bundleMetadata.bundler.appName,
  BUNDLE_APP_NAME,
);
assert.equal(bundleInstructions.bundleMetadata.bundler.appVersion, "1.0.0-rc2");
assert.equal(rangeInstructions.bundleMetadata.bundler.appVersion, "1.0.0-rc2");
assert.deepEqual(
  Array.from(rangeAsset.buffer),
  [137, 80, 78, 71, 13, 10, 26, 10],
);
assert.equal(
  fullResponseInstructions.bundleMetadata.bundler.appVersion,
  "1.0.0-rc2",
);
assert.deepEqual(
  Array.from(fullResponseAsset.buffer),
  [137, 80, 78, 71, 13, 10, 26, 10],
);
assert.equal(fullBundleFetch.getRequestCount(), 1);
assert.equal(
  bundleInstructions.bundleMetadata.project.namespace,
  "project-namespace-1",
);
assert.equal(bundleInstructions.bundleMetadata.project.id, undefined);
assert.deepEqual(
  bundleInstructions.projectData.story.scenes["scene-1"].sections[
    "section-1"
  ].lines.map((line) => line.id),
  ["line-1", "line-2"],
);
assert.deepEqual(projectData.resources.controls["layout-main"].keyboard, {
  enter: {
    actions: {
      nextLine: {},
    },
  },
});
assert.deepEqual(
  projectData.story.scenes["scene-1"].sections["section-1"].lines[0].actions
    .control,
  {
    resourceId: "layout-main",
    resourceType: "control",
  },
);

const graphicsKeyboardRenderState = prepareRenderStateKeyboardForGraphics({
  renderState: {
    elements: [],
    animations: [],
    audio: [],
    global: {
      keyboard: {
        enter: {
          payload: {
            actions: {
              nextLine: {},
            },
          },
        },
      },
    },
  },
});

assert.deepEqual(graphicsKeyboardRenderState.global.keyboard, {
  enter: {
    keydown: {
      payload: {
        actions: {
          nextLine: {},
        },
      },
    },
  },
});

const extraKeyboardRenderState = prepareRenderStateKeyboardForGraphics({
  renderState: {
    elements: [],
    animations: [],
    audio: [],
    global: {
      keyboard: {
        enter: {
          payload: {
            actions: {
              nextLine: {},
            },
          },
        },
        esc: {
          payload: {
            actions: {
              toggleDialogueUI: {},
            },
          },
        },
        space: {
          payload: {
            actions: {
              toggleAutoMode: {},
            },
          },
        },
      },
    },
  },
});

assert.deepEqual(extraKeyboardRenderState.global.keyboard, {
  enter: {
    keydown: {
      payload: {
        actions: {
          nextLine: {},
        },
      },
    },
  },
  escape: {
    keydown: {
      payload: {
        actions: {
          toggleDialogueUI: {},
        },
      },
    },
  },
  space: {
    keydown: {
      payload: {
        actions: {
          toggleAutoMode: {},
        },
      },
    },
  },
});

const disabledKeyboardRenderState = prepareRenderStateKeyboardForGraphics({
  renderState: {
    elements: [],
    animations: [],
    audio: [],
    global: {
      keyboard: {
        enter: {
          payload: {
            actions: {
              nextLine: {},
            },
          },
        },
      },
    },
  },
  enableGlobalKeyboardBindings: false,
});

assert.equal(disabledKeyboardRenderState.global.keyboard, undefined);

assert.equal((await repository.loadEvents()).length, 15);

assert.equal(getSceneReadingSpeed("en"), 200);
assert.equal(getSceneReadingSpeed("ja"), 400);
assert.equal(getSceneReadingSpeed("zh-Hans"), 400);

assert.equal(calculateSceneReadingTimeMinutes({}, { language: "en" }), 0);
assert.equal(
  calculateSceneReadingTimeMinutes(
    { lineCount: 1, wordCount: 50, characterCount: 250 },
    { language: "en" },
  ),
  0,
);
assert.equal(
  calculateSceneReadingTimeMinutes(
    { lineCount: 5, wordCount: 200, characterCount: 1000 },
    { language: "en" },
  ),
  1,
);
assert.equal(
  calculateSceneReadingTimeMinutes(
    { lineCount: 10, wordCount: 250, characterCount: 1250 },
    { language: "en" },
  ),
  1,
);
assert.equal(
  calculateSceneReadingTimeMinutes(
    { lineCount: 10, wordCount: 300, characterCount: 1500 },
    { language: "en" },
  ),
  2,
);
assert.equal(
  calculateSceneReadingTimeMinutes(
    { lineCount: 20, wordCount: 850, characterCount: 4250 },
    { language: "en" },
  ),
  4,
);

assert.equal(
  calculateSceneReadingTimeMinutes(
    { lineCount: 5, wordCount: 0, characterCount: 350 },
    { language: "ja" },
  ),
  1,
);
assert.equal(
  calculateSceneReadingTimeMinutes(
    { lineCount: 10, wordCount: 0, characterCount: 400 },
    { language: "ja" },
  ),
  1,
);
assert.equal(
  calculateSceneReadingTimeMinutes(
    { lineCount: 10, wordCount: 0, characterCount: 600 },
    { language: "zh-Hans" },
  ),
  2,
);

assert.equal(
  formatSceneTextStatsLabel(
    { lineCount: 0, wordCount: 0, characterCount: 0 },
    { language: "en" },
  ),
  "0 lines 0 words",
);
assert.equal(
  formatSceneTextStatsLabel(
    { lineCount: 1, wordCount: 1, characterCount: 5 },
    { language: "en" },
  ),
  "1 line 1 word < 1 min read",
);
assert.equal(
  formatSceneTextStatsLabel(
    { lineCount: 5, wordCount: 50, characterCount: 250 },
    { language: "en" },
  ),
  "5 lines 50 words < 1 min read",
);
assert.equal(
  formatSceneTextStatsLabel(
    { lineCount: 10, wordCount: 200, characterCount: 1000 },
    { language: "en" },
  ),
  "10 lines 200 words 1 min read",
);
assert.equal(
  formatSceneTextStatsLabel(
    { lineCount: 12, wordCount: 450, characterCount: 2250 },
    { language: "en" },
  ),
  "12 lines 450 words 2 mins read",
);
assert.equal(
  formatSceneTextStatsLabel(
    { lineCount: 4, wordCount: 0, characterCount: 150 },
    {
      language: "ja",
      copy: {
        sceneTextStatsLineLabel: "{count}行",
        sceneTextStatsLinesLabel: "{count}行",
        sceneTextStatsCharacterLabel: "{count}文字",
        sceneTextStatsCharactersLabel: "{count}文字",
        sceneTextStatsReadingTimeUnderMinuteLabel: "読了 1分未満",
        sceneTextStatsReadingTimeMinuteLabel: "読了 約{count}分",
        sceneTextStatsReadingTimeMinutesLabel: "読了 約{count}分",
      },
    },
  ),
  "4行 150文字 読了 1分未満",
);
assert.equal(
  formatSceneTextStatsLabel(
    { lineCount: 8, wordCount: 0, characterCount: 600 },
    {
      language: "ja",
      copy: {
        sceneTextStatsLineLabel: "{count}行",
        sceneTextStatsLinesLabel: "{count}行",
        sceneTextStatsCharacterLabel: "{count}文字",
        sceneTextStatsCharactersLabel: "{count}文字",
        sceneTextStatsReadingTimeUnderMinuteLabel: "読了 1分未満",
        sceneTextStatsReadingTimeMinuteLabel: "読了 約{count}分",
        sceneTextStatsReadingTimeMinutesLabel: "読了 約{count}分",
      },
    },
  ),
  "8行 600文字 読了 約2分",
);
assert.equal(
  formatSceneTextStatsLabel(
    { lineCount: 4, wordCount: 0, characterCount: 150 },
    {
      language: "zh-Hans",
      copy: {
        sceneTextStatsLineLabel: "{count} 行",
        sceneTextStatsLinesLabel: "{count} 行",
        sceneTextStatsCharacterLabel: "{count} 个字",
        sceneTextStatsCharactersLabel: "{count} 个字",
        sceneTextStatsReadingTimeUnderMinuteLabel: "阅读时间 < 1 分钟",
        sceneTextStatsReadingTimeMinuteLabel: "阅读时间约 {count} 分钟",
        sceneTextStatsReadingTimeMinutesLabel: "阅读时间约 {count} 分钟",
      },
    },
  ),
  "4 行 150 个字 阅读时间 < 1 分钟",
);
assert.equal(
  formatSceneTextStatsLabel(
    { lineCount: 8, wordCount: 0, characterCount: 600 },
    {
      language: "zh-Hans",
      copy: {
        sceneTextStatsLineLabel: "{count} 行",
        sceneTextStatsLinesLabel: "{count} 行",
        sceneTextStatsCharacterLabel: "{count} 个字",
        sceneTextStatsCharactersLabel: "{count} 个字",
        sceneTextStatsReadingTimeUnderMinuteLabel: "阅读时间 < 1 分钟",
        sceneTextStatsReadingTimeMinuteLabel: "阅读时间约 {count} 分钟",
        sceneTextStatsReadingTimeMinutesLabel: "阅读时间约 {count} 分钟",
      },
    },
  ),
  "8 行 600 个字 阅读时间约 2 分钟",
);

console.log("Smoke tests: PASS");

