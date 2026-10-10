/** Interactive product illustration and source-bound Linux download links. */
const modes = {
  chat: { label: 'Independent chat', heading: 'Follow a thought.', prompt: 'Help me turn a rough idea into a clear plan.', body: '<p>Start with a question, a sketch, or something you want to understand. Keep the conversation going at your own pace.</p><div class="demo-file"><header>My next idea</header><article><h4>A little clarity goes a long way.</h4><p>Explore the possibilities. Ask a follow-up. Save the files you create along the way.</p></article></div>', placeholder: 'Ask a question. Follow a thought.' },
  coding: { label: 'Coding workspace', heading: 'Make something you can run.', prompt: 'Build a small reading tracker for this project.', body: '<p>Work alongside your files. Ask for a change, inspect the result, and keep the next step in the same conversation.</p><div class="demo-file"><header>reading-tracker / src / app.ts</header><pre>const books = await library.list();\n\nfunction readingProgress(book) {\n  return book.pagesRead / book.totalPages;\n}\n\nrender(books.map(readingProgress));</pre></div>', placeholder: 'Describe what you want to build.' },
  research: { label: 'Research workspace', heading: 'Bring the pieces together.', prompt: 'Compare these sources and draft a research brief.', body: '<p>Keep sources, project notes, and useful evidence close to the conversation. Move from reading to a brief you can work with.</p><div class="demo-file"><header>research-brief.md</header><article><h4>What the sources tell us</h4><p>Compare the findings, note the gaps, and identify the next question.</p><div class="source-list"><span>Sources<br>Collected material</span><span>Notes<br>Working observations</span></div></article></div>', placeholder: 'Explore a topic. Connect the evidence.' },
  writing: { label: 'Writing workspace', heading: 'Find the words. Keep your voice.', prompt: 'Help me shape the opening of this chapter.', body: '<p>Draft, revise, and work with your documents alongside the chat. Give an unfinished thought enough space to become a story.</p><div class="demo-file"><header>chapter-one.md</header><article><h4>The first page</h4><p>The station was quiet when she arrived. In her pocket, the folded letter felt heavier than everything she had left behind.</p><p>She read the address once more, then stepped into the morning.</p></article></div>', placeholder: 'Write the next part of your story.' },
};
const tabs = [...document.querySelectorAll('[data-mode]')];
function selectMode(tab) {
  const mode = modes[tab.dataset.mode];
  for (const item of tabs) { const selected = item === tab; item.setAttribute('aria-selected', String(selected)); item.tabIndex = selected ? 0 : -1; }
  document.getElementById('workflow-panel').setAttribute('aria-labelledby', tab.id);
  const content = document.getElementById('demo-content');
  content.innerHTML = `<p class="demo-label">${mode.label}</p><h3>${mode.heading}</h3><div class="demo-prompt">${mode.prompt}</div>${mode.body}`;
  document.getElementById('demo-placeholder').textContent = mode.placeholder;
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectMode(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); selectMode(tabs[next]); tabs[next].focus(); }
  });
}
selectMode(tabs[0]);
async function loadRelease() {
  const status = document.getElementById('download-status');
  try {
    const response = await fetch('./release.json', { cache: 'no-cache' });
    if (!response.ok) throw Error('Release manifest unavailable');
    const release = await response.json();
    const expected = 'https://github.com/arzvaak/BharatCode-Extensions/releases/';
    if (typeof release.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(release.version) || release.url !== `${expected}tag/v${release.version}`) throw Error('Invalid release manifest');
    for (const kind of ['rpm', 'deb', 'AppImage']) {
      const asset = release.packages?.[kind];
      if (!asset || !/^[A-Za-z0-9._-]+$/.test(asset.name) || !asset.name.endsWith(`.${kind}`) || asset.url !== `${expected}download/v${release.version}/${asset.name}`) throw Error('Invalid package download');
    }
    document.getElementById('release-version').textContent = `Preview ${release.version}`;
    document.getElementById('release-notes').href = release.url;
    for (const kind of ['rpm', 'deb', 'AppImage']) {
      const asset = release.packages?.[kind];
      if (!asset?.url?.startsWith(`${expected}download/`) || !/^[A-Za-z0-9._-]+$/.test(asset.name) || !asset.name.endsWith(`.${kind}`)) throw Error('Invalid package download');
      document.querySelector(`[data-package="${kind}"]`).href = asset.url;
      const command = kind === 'rpm' ? `sudo dnf install ./${asset.name}` : kind === 'deb' ? `sudo apt install ./${asset.name}` : `chmod +x ./${asset.name}\n./${asset.name}`;
      document.querySelector(`[data-command="${kind}"]`).textContent = command;
      document.querySelector(`[data-copy="${kind}"]`).addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(command); status.textContent = 'Installation command copied.'; }
        catch { status.textContent = 'Select and copy the installation command above.'; }
      });
    }
  } catch { status.textContent = 'Direct downloads are unavailable right now. Open GitHub releases using a download button above.'; }
}
void loadRelease();
