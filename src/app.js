(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const SAMPLE_URL = "samples/example-ast.json";

  const layoutConstants = {
    minNodeWidth: 150,
    maxNodeWidth: 440,
    charWidth: 7.1,
    titleCharWidth: 7.8,
    paddingX: 12,
    paddingTop: 10,
    lineHeight: 16,
    titleHeight: 20,
    titleGap: 4,
    horizontalGap: 34,
    verticalGap: 78
  };

  const state = {
    ast: null,
    layout: null,
    totalNodes: 0,
    visibleNodes: 0,
    treeDepth: 0,
    matchCount: 0,
    selectedPath: null,
    collapsedPaths: new Set(),
    highlightNodePaths: new Set(),
    highlightEdgeKeys: new Set(),
    manualOffsets: new Map(),
    layoutByPath: new Map(),
    searchQuery: "",
    showProperties: true,
    maxDepth: 0,
    inputMode: "ast",
    zoom: 1,
    panX: 40,
    panY: 40,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragPanX: 0,
    dragPanY: 0,
    nodeDrag: null,
    suppressNextClick: false
  };

  const elements = {
    fileInput: document.getElementById("fileInput"),
    sampleButton: document.getElementById("sampleButton"),
    fitButton: document.getElementById("fitButton"),
    resetButton: document.getElementById("resetButton"),
    clearButton: document.getElementById("clearButton"),
    renderButton: document.getElementById("renderButton"),
    formatButton: document.getElementById("formatButton"),
    jsonInput: document.getElementById("jsonInput"),
    modeAst: document.getElementById("modeAst"),
    modeSource: document.getElementById("modeSource"),
    languageControl: document.getElementById("languageControl"),
    languageSelect: document.getElementById("languageSelect"),
    message: document.getElementById("message"),
    statusLine: document.getElementById("statusLine"),
    nodeCount: document.getElementById("nodeCount"),
    visibleCount: document.getElementById("visibleCount"),
    treeDepth: document.getElementById("treeDepth"),
    matchCount: document.getElementById("matchCount"),
    nodeDetails: document.getElementById("nodeDetails"),
    searchInput: document.getElementById("searchInput"),
    maxDepthInput: document.getElementById("maxDepthInput"),
    propertiesToggle: document.getElementById("propertiesToggle"),
    expandButton: document.getElementById("expandButton"),
    collapseButton: document.getElementById("collapseButton"),
    layoutButton: document.getElementById("layoutButton"),
    zoomRange: document.getElementById("zoomRange"),
    zoomLabel: document.getElementById("zoomLabel"),
    viewer: document.getElementById("viewer"),
    svg: document.getElementById("treeSvg"),
    contentLayer: document.getElementById("contentLayer"),
    emptyState: document.getElementById("emptyState")
  };

  wireEvents();
  updateStats();
  updateTransform();
  setControls("ast");
  void loadSample();

  function wireEvents() {
    elements.fileInput.addEventListener("change", handleFileChange);
    elements.sampleButton.addEventListener("click", () => void loadSample());
    elements.fitButton.addEventListener("click", fitToView);
    elements.resetButton.addEventListener("click", resetView);
    elements.clearButton.addEventListener("click", clearInput);
    elements.renderButton.addEventListener("click", () => void renderCurrent());
    elements.formatButton.addEventListener("click", formatInput);
    elements.modeAst.addEventListener("click", () => {
      setControls("ast");
      void restoreAstSample(false);
    });
    elements.modeSource.addEventListener("click", () => {
      setControls("source");
      restoreSourceSample(false);
    });
    elements.languageSelect.addEventListener("change", () => {
      if (state.inputMode === "source") {
        restoreSourceSample(true);
      } else {
        void restoreAstSample(true);
      }
    });
    elements.searchInput.addEventListener("input", () => {
      state.searchQuery = elements.searchInput.value.trim().toLowerCase();
      renderTree();
    });
    elements.maxDepthInput.addEventListener("input", () => {
      state.maxDepth = Math.max(0, Number.parseInt(elements.maxDepthInput.value, 10) || 0);
      renderTree();
    });
    elements.propertiesToggle.addEventListener("change", () => {
      state.showProperties = elements.propertiesToggle.checked;
      renderTree();
    });
    elements.expandButton.addEventListener("click", expandSelectedNode);
    elements.collapseButton.addEventListener("click", collapseSelectedNode);
    elements.layoutButton.addEventListener("click", resetLayoutPositions);
    elements.zoomRange.addEventListener("input", () => {
      setZoom(Number.parseInt(elements.zoomRange.value, 10) / 100);
    });

    elements.svg.addEventListener("pointermove", moveNode);
    elements.svg.addEventListener("pointerup", stopNode);
    elements.svg.addEventListener("pointercancel", stopNode);
    elements.viewer.addEventListener("pointerdown", startPan);
    elements.viewer.addEventListener("pointermove", movePan);
    elements.viewer.addEventListener("pointerup", stopPan);
    elements.viewer.addEventListener("pointercancel", stopPan);
    elements.viewer.addEventListener("wheel", zoomOnWheel, { passive: false });
    window.addEventListener("resize", () => {
      if (state.layout) {
        updateSvgSize();
      }
    });
  }

  async function handleFileChange(event) {
    const [file] = event.target.files;
    if (!file) {
      return;
    }

    try {
       const text = await file.text();
       elements.jsonInput.value = text;
       setControls("ast");
       renderFromInput();
       setMessage(`Loaded ${file.name}`);
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      elements.fileInput.value = "";
    }
  }

  async function loadSample() {
    try {
      const response = await fetch(SAMPLE_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Sample request failed: ${response.status}`);
      }
      const text = await response.text();
      elements.jsonInput.value = text;
      setControls("ast");
      renderFromInput();
      setMessage("Sample AST loaded");
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  function renderFromInput() {
    try {
      const text = elements.jsonInput.value.trim();
      if (!text) {
        throw new Error("AST input is empty");
      }

      const ast = normalizeAst(JSON.parse(text));
      state.ast = ast;
      state.selectedPath = ast.__path;
      state.collapsedPaths.clear();
      state.manualOffsets.clear();
      renderTree();
      fitToView();
      setMessage("AST rendered");
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  function formatInput() {
    try {
      const text = elements.jsonInput.value.trim();
      if (!text) {
        return;
      }

      elements.jsonInput.value = `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
      setMessage("JSON formatted");
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  const SAMPLE_SOURCES = {
    c: "int main()\n{\n    int x = 1;\n    return x;\n}\n",
    go: "package main\n\nfunc main() {\n\tx := 1\n\tprintln(x)\n}\n",
    java: "class Main {\n    public static void main(String[] args) {\n        int x = 1;\n        System.out.println(x);\n    }\n}\n",
    lua: "local x = 1\nprint(x)\n",
    kotlin: "fun main() {\n    val x = 1\n    println(x)\n}\n",
    python: "def main():\n    x = 1\n    print(x)\n\nmain()\n"
  };

  const sampleAstCache = new Map();

  async function renderCurrent() {
    if (state.inputMode === "source") {
      await generateAstFromSource();
      return;
    }
    renderFromInput();
  }

  async function generateAstFromSource() {
    const source = elements.jsonInput.value;
    if (!source.trim()) {
      setMessage("Source input is empty", true);
      return;
    }

    const language = currentLanguage();
    setGenerating(true);
    setMessage(`Generating AST (${language})…`);

    try {
      const response = await fetch(`/api/ast?language=${encodeURIComponent(language)}`, {
        method: "POST",
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: source
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(text || `linvast failed (HTTP ${response.status})`);
      }

      JSON.parse(text);

      elements.jsonInput.value = text;
      setControls("ast");
      renderFromInput();
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      setGenerating(false);
    }
  }

  function setGenerating(isGenerating) {
    elements.renderButton.disabled = isGenerating;
    elements.renderButton.textContent = isGenerating ? "Generating…" : "Render";
  }

  function currentLanguage() {
    return elements.languageSelect.value || "c";
  }

  function isAstJson(text) {
    if (!text.trim()) {
      return false;
    }
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }

  function setControls(mode) {
    state.inputMode = mode;
    elements.modeAst.setAttribute("aria-selected", mode === "ast");
    elements.modeSource.setAttribute("aria-selected", mode === "source");
    elements.languageControl.hidden = mode !== "source";
    elements.formatButton.hidden = mode !== "ast";
    elements.jsonInput.placeholder = mode === "ast"
      ? "Paste LINVAST AST JSON"
      : "Paste source code (C, Go, Java, Lua, Kotlin, Python)";
  }

  function restoreSourceSample(force) {
    const lang = currentLanguage();
    const current = elements.jsonInput.value;
    if (force || current.trim() === "" || isAstJson(current)) {
      elements.jsonInput.value = SAMPLE_SOURCES[lang] || SAMPLE_SOURCES.c;
    }
  }

  async function restoreAstSample(force) {
    const lang = currentLanguage();
    const current = elements.jsonInput.value;

    if (!force && isAstJson(current)) {
      renderFromInput();
      return;
    }

    const cached = sampleAstCache.get(lang);
    if (cached) {
      elements.jsonInput.value = cached;
      renderFromInput();
      return;
    }

    setGenerating(true);
    setMessage(`Loading sample AST (${lang})…`);

    try {
      const response = await fetch(`/api/ast?language=${encodeURIComponent(lang)}`, {
        method: "POST",
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: SAMPLE_SOURCES[lang] || SAMPLE_SOURCES.c
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(text || `linvast failed (HTTP ${response.status})`);
      }

      JSON.parse(text);
      sampleAstCache.set(lang, text);
      elements.jsonInput.value = text;
      renderFromInput();
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      setGenerating(false);
    }
  }

  function clearInput() {
    elements.jsonInput.value = "";
    state.ast = null;
    state.layout = null;
    state.selectedPath = null;
    state.collapsedPaths.clear();
    state.highlightNodePaths.clear();
    state.highlightEdgeKeys.clear();
    state.manualOffsets.clear();
    state.layoutByPath.clear();
    elements.contentLayer.replaceChildren();
    elements.emptyState.classList.remove("hidden");
    setMessage("");
    setControls("ast");
    updateStats();
    updateDetails(null);
    elements.statusLine.textContent = "No AST loaded";
  }

  function normalizeAst(value) {
    if (Array.isArray(value)) {
      return normalizeNode({ NodeType: "SourceNode", Line: null, Children: value }, "0");
    }

    if (!value || typeof value !== "object") {
      throw new Error("AST root must be a JSON object");
    }

    return normalizeNode(value, "0");
  }

  function normalizeNode(rawNode, path) {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
      throw new Error(`AST node at ${path} must be an object`);
    }

    const rawChildren = Array.isArray(rawNode.Children)
      ? rawNode.Children
      : Array.isArray(rawNode.children)
        ? rawNode.children
        : [];

    const node = { ...rawNode };
    node.NodeType = String(rawNode.NodeType ?? rawNode.nodeType ?? rawNode.type ?? "UnknownNode");
    node.Line = rawNode.Line ?? rawNode.line ?? null;
    node.Children = rawChildren.map((child, index) => normalizeNode(child, `${path}.${index}`));
    Object.defineProperty(node, "__path", {
      value: path,
      enumerable: false
    });
    return node;
  }

  function renderTree() {
    elements.contentLayer.replaceChildren();

    if (!state.ast) {
      updateStats();
      updateDetails(null);
      elements.emptyState.classList.remove("hidden");
      return;
    }

    const stats = collectStats(state.ast);
    state.totalNodes = stats.count;
    state.treeDepth = stats.depth;
    state.matchCount = 0;
    state.visibleNodes = 0;
    state.layoutByPath.clear();
    updateSelectionSets(state.selectedPath);
    state.layout = buildLayout(state.ast, 0);
    assignLayout(state.layout, 0, 0);

    const connectors = document.createDocumentFragment();
    const nodes = document.createDocumentFragment();
    drawLayout(state.layout, connectors, nodes);
    elements.contentLayer.append(connectors, nodes);

    updateSvgSize();
    updateStats();
    updateDetails(findNodeByPath(state.ast, state.selectedPath));
    elements.emptyState.classList.add("hidden");
    elements.statusLine.textContent = `${state.totalNodes} nodes, depth ${state.treeDepth}`;
  }

  function buildLayout(node, depth) {
    const isDepthCutoff = state.maxDepth > 0 && depth >= state.maxDepth && node.Children.length > 0;
    const isCollapsed = state.collapsedPaths.has(node.__path) && node.Children.length > 0;
    const isHidden = isDepthCutoff || isCollapsed;
    const lines = getNodeLines(node, {
      showProperties: state.showProperties,
      isDepthCutoff,
      isCollapsed
    });
    const size = measureNode(node, lines);
    const children = isHidden ? [] : node.Children.map(child => buildLayout(child, depth + 1));
    const childrenWidth = getChildrenWidth(children);
    const width = Math.max(size.width, childrenWidth);
    const height = children.length === 0
      ? size.height
      : size.height + layoutConstants.verticalGap + Math.max(...children.map(child => child.height));

    state.visibleNodes += 1;

    return {
      node,
      lines,
      size,
      children,
      width,
      height,
      x: 0,
      y: 0,
      centerX: 0,
      topY: 0,
      bottomY: 0,
      isDepthCutoff,
      isCollapsed,
      isMatch: matchesSearch(node)
    };
  }

  function assignLayout(layout, left, top) {
    const offset = state.manualOffsets.get(layout.node.__path) ?? { x: 0, y: 0 };
    layout.baseCenterX = left + layout.width / 2;
    layout.baseX = layout.baseCenterX - layout.size.width / 2;
    layout.baseY = top;
    layout.centerX = layout.baseCenterX + offset.x;
    layout.x = layout.baseX + offset.x;
    layout.y = layout.baseY + offset.y;
    updateLayoutAnchors(layout);
    state.layoutByPath.set(layout.node.__path, layout);

    if (layout.children.length === 0) {
      return;
    }

    const childTop = top + layout.size.height + layoutConstants.verticalGap;
    let childLeft = left + (layout.width - getChildrenWidth(layout.children)) / 2;
    for (const child of layout.children) {
      assignLayout(child, childLeft, childTop);
      childLeft += child.width + layoutConstants.horizontalGap;
    }
  }

  function drawLayout(layout, connectors, nodes) {
    if (layout.isMatch) {
      state.matchCount += 1;
    }

    for (const child of layout.children) {
      connectors.append(createConnector(layout, child));
      drawLayout(child, connectors, nodes);
    }

    nodes.append(createNodeElement(layout));
  }

  function createConnector(parent, child) {
    const key = edgeKey(parent.node.__path, child.node.__path);
    const line = svgElement("line", {
      class: state.highlightEdgeKeys.has(key) ? "connector connector-highlight" : "connector",
      x1: parent.centerX,
      y1: parent.bottomY,
      x2: child.centerX,
      y2: child.topY
    });
    line.dataset.edge = key;
    line.dataset.parentPath = parent.node.__path;
    line.dataset.childPath = child.node.__path;
    return line;
  }

  function createNodeElement(layout) {
    const group = svgElement("g", {
      class: getNodeClass(layout),
      transform: `translate(${layout.x} ${layout.y})`,
      tabindex: "0",
      role: "button",
      "aria-label": `${layout.node.NodeType} at line ${formatLine(layout.node.Line)}`
    });

    group.dataset.path = layout.node.__path;
    group.addEventListener("pointerdown", event => startNodeDrag(event, layout.node.__path));
    group.addEventListener("click", event => {
      event.stopPropagation();
      if (state.suppressNextClick) {
        state.suppressNextClick = false;
        return;
      }
      selectNode(layout.node.__path);
    });
    group.addEventListener("dblclick", event => {
      event.stopPropagation();
      toggleCollapse(layout.node.__path);
    });
    group.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleCollapse(layout.node.__path);
      }
    });

    group.append(svgElement("rect", {
      class: "node-rect",
      width: layout.size.width,
      height: layout.size.height,
      rx: 7,
      ry: 7
    }));

    const titleText = truncateText(layout.node.NodeType, 42);
    const title = svgElement("text", {
      class: "node-title",
      x: layoutConstants.paddingX,
      y: layoutConstants.paddingTop + 13
    });
    title.textContent = titleText;
    title.append(svgElement("title", {}, layout.node.NodeType));
    group.append(title);

    let y = layoutConstants.paddingTop + layoutConstants.titleHeight + layoutConstants.titleGap + 11;
    for (const lineText of layout.lines) {
      const line = svgElement("text", {
        class: "node-line",
        x: layoutConstants.paddingX,
        y
      });
      line.textContent = lineText.display;
      line.append(svgElement("title", {}, lineText.full));
      group.append(line);
      y += layoutConstants.lineHeight;
    }

    return group;
  }

  function getNodeClass(layout) {
    const classes = ["node", getNodeKindClass(layout.node)];
    if (layout.node.__path === state.selectedPath) {
      classes.push("node-selected");
    } else if (state.highlightNodePaths.has(layout.node.__path)) {
      classes.push("node-neighbor");
    }
    if (layout.isMatch) {
      classes.push("node-match");
    }
    if (layout.isDepthCutoff) {
      classes.push("node-cutoff");
    }
    if (layout.isCollapsed) {
      classes.push("node-collapsed");
    }
    return classes.join(" ");
  }

  function getNodeKindClass(node) {
    const type = node.NodeType.toLowerCase();
    if (type.includes("decl") || type.includes("param")) {
      return "node-kind-declaration";
    }
    if (type.includes("expr") || type.includes("idnode") || type.includes("lit")) {
      return "node-kind-expression";
    }
    if (type.includes("stat") || type.includes("block") || type.includes("switch")) {
      return "node-kind-statement";
    }
    return "node-kind-default";
  }

  function selectNode(path) {
    state.selectedPath = path;
    updateDetails(findNodeByPath(state.ast, path));
    updateSelectionSets(path);
    updateSelectionHighlights();
  }

  function toggleCollapse(path) {
    const node = findNodeByPath(state.ast, path);
    if (!node || node.Children.length === 0) {
      return;
    }

    if (state.collapsedPaths.has(path)) {
      state.collapsedPaths.delete(path);
    } else {
      state.collapsedPaths.add(path);
    }
    renderTree();
  }

  function expandSelectedNode() {
    const node = findNodeByPath(state.ast, state.selectedPath);
    if (!node) {
      setMessage("Select a node to expand", true);
      return;
    }

    const removed = removeCollapsedPathsInSubtree(node);
    renderTree();
    setMessage(removed > 0 ? `Expanded ${node.NodeType}` : `${node.NodeType} is already expanded`);
  }

  function collapseSelectedNode() {
    const node = findNodeByPath(state.ast, state.selectedPath);
    if (!node) {
      setMessage("Select a node to collapse", true);
      return;
    }

    if (node.Children.length === 0) {
      setMessage(`${node.NodeType} has no children`);
      return;
    }

    state.collapsedPaths.add(node.__path);
    renderTree();
    setMessage(`Collapsed ${node.NodeType}`);
  }

  function resetLayoutPositions() {
    if (state.manualOffsets.size === 0) {
      setMessage("Layout is already using computed positions");
      return;
    }

    state.manualOffsets.clear();
    renderTree();
    setMessage("Layout reset");
  }

  function removeCollapsedPathsInSubtree(node) {
    let removed = 0;
    if (state.collapsedPaths.delete(node.__path)) {
      removed += 1;
    }

    for (const child of node.Children) {
      removed += removeCollapsedPathsInSubtree(child);
    }

    return removed;
  }

  function updateSelectionSets(path) {
    state.highlightNodePaths.clear();
    state.highlightEdgeKeys.clear();

    const node = findNodeByPath(state.ast, path);
    if (!node) {
      return;
    }

    const parentPath = getParentPath(path);
    if (parentPath) {
      state.highlightNodePaths.add(parentPath);
      state.highlightEdgeKeys.add(edgeKey(parentPath, path));
    }

    for (const child of node.Children) {
      state.highlightNodePaths.add(child.__path);
      state.highlightEdgeKeys.add(edgeKey(path, child.__path));
    }
  }

  function updateSelectionHighlights() {
    for (const element of elements.contentLayer.querySelectorAll(".node")) {
      const path = element.dataset.path;
      element.classList.toggle("node-selected", path === state.selectedPath);
      element.classList.toggle("node-neighbor", path !== state.selectedPath && state.highlightNodePaths.has(path));
    }

    for (const element of elements.contentLayer.querySelectorAll(".connector")) {
      element.classList.toggle("connector-highlight", state.highlightEdgeKeys.has(element.dataset.edge));
    }
  }

  function startNodeDrag(event, path) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selectNode(path);

    const offset = state.manualOffsets.get(path) ?? { x: 0, y: 0 };
    const element = findNodeElement(path);
    state.nodeDrag = {
      path,
      element,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
      hasMoved: false
    };

    element?.classList.add("node-dragging");
    elements.viewer.classList.add("is-moving-node");

    if (typeof event.currentTarget.setPointerCapture === "function") {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Some synthetic/browser automation events cannot be captured.
      }
    }
  }

  function moveNode(event) {
    const drag = state.nodeDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const screenDeltaX = event.clientX - drag.startClientX;
    const screenDeltaY = event.clientY - drag.startClientY;
    if (!drag.hasMoved && Math.hypot(screenDeltaX, screenDeltaY) < 3) {
      return;
    }

    drag.hasMoved = true;
    state.manualOffsets.set(drag.path, {
      x: drag.startOffsetX + screenDeltaX / state.zoom,
      y: drag.startOffsetY + screenDeltaY / state.zoom
    });
    applyManualNodeOffset(drag.path);
  }

  function stopNode(event) {
    const drag = state.nodeDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    drag.element?.classList.remove("node-dragging");
    elements.viewer.classList.remove("is-moving-node");

    if (drag.hasMoved) {
      state.suppressNextClick = true;
      const node = findNodeByPath(state.ast, drag.path);
      setMessage(node ? `Moved ${node.NodeType}` : "Moved node");
    }

    if (drag.element && typeof drag.element.releasePointerCapture === "function") {
      try {
        drag.element.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore capture release failures from synthetic events.
      }
    }

    state.nodeDrag = null;
  }

  function applyManualNodeOffset(path) {
    const layout = state.layoutByPath.get(path);
    if (!layout) {
      return;
    }

    const offset = state.manualOffsets.get(path) ?? { x: 0, y: 0 };
    layout.x = layout.baseX + offset.x;
    layout.y = layout.baseY + offset.y;
    layout.centerX = layout.baseCenterX + offset.x;
    updateLayoutAnchors(layout);

    const element = findNodeElement(path);
    if (element) {
      element.setAttribute("transform", `translate(${layout.x} ${layout.y})`);
    }

    updateConnectedConnectors(path);
  }

  function updateLayoutAnchors(layout) {
    layout.topY = layout.y;
    layout.bottomY = layout.y + layout.size.height;
  }

  function updateConnectedConnectors(path) {
    for (const connector of elements.contentLayer.querySelectorAll(".connector")) {
      if (connector.dataset.parentPath === path || connector.dataset.childPath === path) {
        updateConnectorEndpoints(connector);
      }
    }
  }

  function updateConnectorEndpoints(connector) {
    const parent = state.layoutByPath.get(connector.dataset.parentPath);
    const child = state.layoutByPath.get(connector.dataset.childPath);
    if (!parent || !child) {
      return;
    }

    connector.setAttribute("x1", String(parent.centerX));
    connector.setAttribute("y1", String(parent.bottomY));
    connector.setAttribute("x2", String(child.centerX));
    connector.setAttribute("y2", String(child.topY));
  }

  function getLayoutBounds(layout) {
    const bounds = {
      minX: layout.x,
      minY: layout.y,
      maxX: layout.x + layout.size.width,
      maxY: layout.y + layout.size.height
    };

    for (const child of layout.children) {
      const childBounds = getLayoutBounds(child);
      bounds.minX = Math.min(bounds.minX, childBounds.minX);
      bounds.minY = Math.min(bounds.minY, childBounds.minY);
      bounds.maxX = Math.max(bounds.maxX, childBounds.maxX);
      bounds.maxY = Math.max(bounds.maxY, childBounds.maxY);
    }

    return bounds;
  }

  function findNodeElement(path) {
    for (const element of elements.contentLayer.querySelectorAll(".node")) {
      if (element.dataset.path === path) {
        return element;
      }
    }
    return null;
  }

  function measureNode(node, lines) {
    const titleWidth = Math.min(
      layoutConstants.maxNodeWidth,
      Math.max(layoutConstants.minNodeWidth, node.NodeType.length * layoutConstants.titleCharWidth)
    );
    const lineWidth = lines.reduce(
      (max, line) => Math.max(max, line.display.length * layoutConstants.charWidth),
      0
    );
    const width = clamp(
      Math.ceil(Math.max(titleWidth, lineWidth) + layoutConstants.paddingX * 2),
      layoutConstants.minNodeWidth,
      layoutConstants.maxNodeWidth
    );
    const height = layoutConstants.paddingTop
      + layoutConstants.titleHeight
      + layoutConstants.titleGap
      + lines.length * layoutConstants.lineHeight
      + 10;

    return { width, height };
  }

  function getNodeLines(node, options) {
    const lines = [
      makeLine(`Line: ${formatLine(node.Line)}`),
      makeLine(`Children: ${node.Children.length}`)
    ];

    if (options.isDepthCutoff) {
      lines.push(makeLine("Depth cutoff"));
    }

    if (options.isCollapsed) {
      lines.push(makeLine(`Collapsed: ${node.Children.length}`));
    }

    if (!options.showProperties) {
      return lines;
    }

    for (const key of getPropertyKeys(node)) {
      const value = stringifyValue(node[key]);
      lines.push(makeLine(`${key}: ${value}`));
    }

    return lines;
  }

  function makeLine(text) {
    return {
      full: text,
      display: truncateText(text, 58)
    };
  }

  function getPropertyKeys(node) {
    return Object.keys(node)
      .filter(key => !["Children", "NodeType", "Line", "__path"].includes(key))
      .sort((left, right) => left.localeCompare(right));
  }

  function stringifyValue(value) {
    if (value === null || value === undefined) {
      return "null";
    }
    if (typeof value === "string") {
      return value.length === 0 ? "N/A" : value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function truncateText(text, maxLength) {
    const value = String(text);
    return value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 3))}...` : value;
  }

  function collectStats(root) {
    let count = 0;
    let depth = 0;

    function visit(node, currentDepth) {
      count += 1;
      depth = Math.max(depth, currentDepth);
      for (const child of node.Children) {
        visit(child, currentDepth + 1);
      }
    }

    visit(root, 1);
    return { count, depth };
  }

  function matchesSearch(node) {
    if (!state.searchQuery) {
      return false;
    }

    const haystack = [
      node.NodeType,
      formatLine(node.Line),
      ...getPropertyKeys(node).flatMap(key => [key, stringifyValue(node[key])])
    ].join(" ").toLowerCase();

    return haystack.includes(state.searchQuery);
  }

  function findNodeByPath(node, path) {
    if (!node || !path) {
      return null;
    }
    if (node.__path === path) {
      return node;
    }
    for (const child of node.Children) {
      const found = findNodeByPath(child, path);
      if (found) {
        return found;
      }
    }
    return null;
  }

  function getParentPath(path) {
    const separator = path?.lastIndexOf(".");
    return separator > 0 ? path.slice(0, separator) : null;
  }

  function edgeKey(parentPath, childPath) {
    return `${parentPath}->${childPath}`;
  }

  function updateStats() {
    elements.nodeCount.textContent = String(state.totalNodes);
    elements.visibleCount.textContent = String(state.visibleNodes);
    elements.treeDepth.textContent = String(state.treeDepth);
    elements.matchCount.textContent = String(state.matchCount);
  }

  function updateDetails(node) {
    elements.nodeDetails.replaceChildren();

    if (!node) {
      elements.nodeDetails.className = "node-details empty-details";
      elements.nodeDetails.textContent = "None";
      return;
    }

    elements.nodeDetails.className = "node-details";
    const table = document.createElement("table");
    table.className = "detail-table";
    const tbody = document.createElement("tbody");
    table.append(tbody);

    addDetailRow(tbody, "NodeType", node.NodeType);
    addDetailRow(tbody, "Line", formatLine(node.Line));
    addDetailRow(tbody, "Children", String(node.Children.length));
    for (const key of getPropertyKeys(node)) {
      addDetailRow(tbody, key, stringifyValue(node[key]));
    }

    elements.nodeDetails.append(table);
  }

  function addDetailRow(tbody, name, value) {
    const row = document.createElement("tr");
    const keyCell = document.createElement("th");
    const valueCell = document.createElement("td");
    keyCell.scope = "row";
    keyCell.textContent = name;
    valueCell.textContent = value;
    row.append(keyCell, valueCell);
    tbody.append(row);
  }

  function updateSvgSize() {
    if (!state.layout) {
      elements.svg.setAttribute("viewBox", "0 0 0 0");
      return;
    }

    const rect = elements.viewer.getBoundingClientRect();
    elements.svg.setAttribute("viewBox", `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
  }

  function setZoom(nextZoom, origin) {
    const previousZoom = state.zoom;
    state.zoom = clamp(nextZoom, 0.25, 2.2);

    if (origin) {
      state.panX = origin.x - ((origin.x - state.panX) / previousZoom) * state.zoom;
      state.panY = origin.y - ((origin.y - state.panY) / previousZoom) * state.zoom;
    }

    updateTransform();
  }

  function fitToView() {
    if (!state.layout) {
      return;
    }

    const rect = elements.viewer.getBoundingClientRect();
    const bounds = getLayoutBounds(state.layout);
    const logicalWidth = Math.max(1, bounds.maxX - bounds.minX);
    const logicalHeight = Math.max(1, bounds.maxY - bounds.minY);
    const availableWidth = Math.max(1, rect.width - 60);
    const availableHeight = Math.max(1, rect.height - 60);
    const nextZoom = clamp(
      Math.min(availableWidth / logicalWidth, availableHeight / logicalHeight),
      0.25,
      2.2
    );

    state.zoom = nextZoom;
    state.panX = (rect.width - logicalWidth * nextZoom) / 2 - bounds.minX * nextZoom;
    state.panY = 30 - bounds.minY * nextZoom;
    updateTransform();
  }

  function resetView() {
    state.zoom = 1;
    state.panX = 40;
    state.panY = 40;
    updateTransform();
  }

  function updateTransform() {
    elements.contentLayer.setAttribute("transform", `translate(${state.panX} ${state.panY}) scale(${state.zoom})`);
    elements.zoomRange.value = String(Math.round(state.zoom * 100));
    elements.zoomLabel.value = `${Math.round(state.zoom * 100)}%`;
    elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function startPan(event) {
    if (state.nodeDrag) {
      return;
    }

    if (event.target.closest(".node")) {
      return;
    }

    state.isDragging = true;
    state.dragStartX = event.clientX;
    state.dragStartY = event.clientY;
    state.dragPanX = state.panX;
    state.dragPanY = state.panY;
    elements.viewer.classList.add("is-dragging");
    elements.viewer.setPointerCapture(event.pointerId);
  }

  function movePan(event) {
    if (!state.isDragging) {
      return;
    }

    state.panX = state.dragPanX + event.clientX - state.dragStartX;
    state.panY = state.dragPanY + event.clientY - state.dragStartY;
    updateTransform();
  }

  function stopPan(event) {
    if (!state.isDragging) {
      return;
    }

    state.isDragging = false;
    elements.viewer.classList.remove("is-dragging");
    if (elements.viewer.hasPointerCapture(event.pointerId)) {
      elements.viewer.releasePointerCapture(event.pointerId);
    }
  }

  function zoomOnWheel(event) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    const rect = elements.viewer.getBoundingClientRect();
    const origin = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    setZoom(state.zoom * factor, origin);
  }

  function getChildrenWidth(children) {
    if (children.length === 0) {
      return 0;
    }

    return children.reduce((sum, child) => sum + child.width, 0)
      + layoutConstants.horizontalGap * (children.length - 1);
  }

  function svgElement(name, attributes = {}, text = null) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, String(value));
    }
    if (text !== null) {
      element.textContent = text;
    }
    return element;
  }

  function formatLine(line) {
    return line === null || line === undefined || line === "" ? "N/A" : String(line);
  }

  function setMessage(message, isError = false) {
    elements.message.textContent = message;
    elements.message.classList.toggle("error", isError);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();
