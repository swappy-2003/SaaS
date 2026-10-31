/** Browser code for the same-origin operator dashboard. No frontend build step is required. */
export const dashboardScript = String.raw`(() => {
  const app = document.getElementById('app');
  const tokenKey = 'ragbot.dashboard.accessToken';
  let token = sessionStorage.getItem(tokenKey) || '';
  let organizations = [], projects = [], websites = [], selectedOrg = '', selectedProject = '', selectedWebsite = '', verification = '';
  const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const api = async (path, options = {}) => {
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(options.headers || {}) };
    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Request failed (' + response.status + ').');
    return data;
  };
  const notice = (text, kind = '') => '<p class="notice ' + kind + '">' + escape(text) + '</p>';
  const projectOptions = () => projects.map((project) => '<option value="' + project.id + '"' + (project.id === selectedProject ? ' selected' : '') + '>' + escape(project.name) + '</option>').join('');
  const websiteOptions = () => websites.map((website) => '<option value="' + website.id + '"' + (website.id === selectedWebsite ? ' selected' : '') + '>' + escape(website.name) + ' (' + escape(website.status) + ')</option>').join('');
  const currentWebsite = () => websites.find((website) => website.id === selectedWebsite);
  const setError = (error) => { const node = document.getElementById('flash'); if (node) node.innerHTML = notice(error instanceof Error ? error.message : String(error), 'error'); };

  async function load() {
    const [orgData, projectData] = await Promise.all([api('/organizations'), api('/projects')]);
    organizations = orgData.organizations || []; projects = projectData.projects || [];
    if (!selectedOrg || !organizations.some((org) => org.id === selectedOrg)) selectedOrg = organizations[0] && organizations[0].id || '';
    if (!selectedProject || !projects.some((project) => project.id === selectedProject)) selectedProject = projects[0] && projects[0].id || '';
    await loadWebsites(); render();
  }
  async function loadWebsites() {
    if (!selectedProject) { websites = []; selectedWebsite = ''; return; }
    const data = await api('/projects/' + selectedProject + '/websites'); websites = data.websites || [];
    if (!selectedWebsite || !websites.some((website) => website.id === selectedWebsite)) selectedWebsite = websites[0] && websites[0].id || '';
  }
  function renderAuth() {
    app.innerHTML = '<main class="auth"><h1>Ragbot Dashboard</h1><p>Set up your website assistant.</p><div id="flash"></div><div class="columns"><form id="login" class="card"><h2>Sign in</h2><label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" minlength="12" required></label><button>Sign in</button></form><form id="register" class="card"><h2>Create account</h2><label>Organization<input name="organizationName" required minlength="2"></label><label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" minlength="12" required></label><button>Create account</button></form></div></main>';
    for (const id of ['login', 'register']) document.getElementById(id).addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); try { const data = await api('/auth/' + id, { method: 'POST', body: JSON.stringify(values) }); token = data.accessToken; sessionStorage.setItem(tokenKey, token); await load(); } catch (error) { setError(error); } });
  }
  function render() {
    if (!token) return renderAuth();
    const website = currentWebsite();
    app.innerHTML = '<main><header><div><h1>Ragbot Dashboard</h1><p>Set up, index, test, and install your assistant.</p></div><button id="logout" class="quiet">Sign out</button></header><div id="flash">' + (verification ? notice(verification, 'success') : '') + '</div><section class="card"><h2>1. Project</h2><div class="grid"><label>Organization<select id="org">' + organizations.map((org) => '<option value="' + org.id + '"' + (org.id === selectedOrg ? ' selected' : '') + '>' + escape(org.name) + '</option>').join('') + '</select></label><label>Project<select id="project"><option value="">Select a project</option>' + projectOptions() + '</select></label></div><form id="new-project" class="inline"><input name="name" placeholder="Project name" required><input name="slug" placeholder="project-slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required><button>Create project</button></form></section><section class="card"><h2>2. Website</h2>' + (selectedProject ? '<form id="new-website" class="grid"><label>Name<input name="name" placeholder="Acme website" required></label><label>Root URL<input name="url" type="url" placeholder="https://www.example.com/" required></label><label class="wide">Allowed browser origin(s), comma-separated<input name="origins" placeholder="https://www.example.com" required></label><button>Add website</button></form><div class="inline"><label>Website<select id="website"><option value="">Select a website</option>' + websiteOptions() + '</select></label></div>' : '<p>Create a project first.</p>') + '</section>' + (website ? websitePanel(website) : '') + '</main>';
    bind();
  }
  function websitePanel(website) {
    return '<section class="card"><h2>3. ' + escape(website.name) + '</h2><dl><dt>Status</dt><dd>' + escape(website.status) + '</dd><dt>URL</dt><dd>' + escape(website.url) + '</dd><dt>Indexed</dt><dd>' + website.indexedPageCount + ' pages, ' + website.indexedChunkCount + ' chunks</dd></dl><div class="inline"><button id="verify">Verify ownership</button><button id="index">Start indexing</button><button id="refresh" class="quiet">Refresh status</button></div></section><section class="card"><h2>4. Assistant and install</h2><form id="assistant" class="grid"><label>Name<input name="name" value="' + escape(website.name) + ' Assistant" required></label><label>Welcome message<input name="welcomeMessage" value="Hi! How can I help?" required></label><label>Primary color<input name="primaryColor" value="#2563eb" pattern="#[0-9a-fA-F]{3,8}"></label><button>Save assistant</button></form><pre id="install">Save the assistant to generate the install snippet.</pre></section><section class="card"><h2>5. Test chat</h2><form id="test-chat" class="inline"><input name="message" placeholder="Ask a question about this website" required><button>Send test</button></form><div id="test-result" class="answer"></div></section>';
  }
  async function saveAssistant(form) {
    const website = currentWebsite(); const values = Object.fromEntries(new FormData(form));
    const data = await api('/websites/' + website.id + '/assistant', { method: 'PUT', body: JSON.stringify({ name: values.name, welcomeMessage: values.welcomeMessage, theme: { primaryColor: values.primaryColor } }) });
    const snippet = '<script src="' + window.location.origin + '/widget.js" data-assistant="' + data.assistant.publicId + '" async><\/script>';
    document.getElementById('install').textContent = snippet;
  }
  function bind() {
    document.getElementById('logout').onclick = () => { token = ''; sessionStorage.removeItem(tokenKey); renderAuth(); };
    document.getElementById('org').onchange = (event) => { selectedOrg = event.target.value; render(); };
    document.getElementById('project').onchange = async (event) => { selectedProject = event.target.value; selectedWebsite = ''; try { await loadWebsites(); render(); } catch (error) { setError(error); } };
    const websiteSelect = document.getElementById('website'); if (websiteSelect) websiteSelect.onchange = (event) => { selectedWebsite = event.target.value; render(); };
    const projectForm = document.getElementById('new-project'); projectForm.onsubmit = async (event) => { event.preventDefault(); try { const values = Object.fromEntries(new FormData(projectForm)); await api('/organizations/' + selectedOrg + '/projects', { method: 'POST', body: JSON.stringify(values) }); verification = 'Project created.'; await load(); } catch (error) { setError(error); } };
    const websiteForm = document.getElementById('new-website'); if (websiteForm) websiteForm.onsubmit = async (event) => { event.preventDefault(); try { const values = Object.fromEntries(new FormData(websiteForm)); const allowedOrigins = String(values.origins).split(',').map((value) => value.trim()).filter(Boolean); const data = await api('/projects/' + selectedProject + '/websites', { method: 'POST', body: JSON.stringify({ name: values.name, url: values.url, allowedOrigins }) }); selectedWebsite = data.website.id; verification = data.verification.instruction; await loadWebsites(); render(); } catch (error) { setError(error); } };
    const website = currentWebsite(); if (!website) return;
    document.getElementById('refresh').onclick = async () => { try { await loadWebsites(); render(); } catch (error) { setError(error); } };
    document.getElementById('verify').onclick = async () => { try { await api('/websites/' + website.id + '/verify', { method: 'POST' }); verification = 'Website ownership verified.'; await loadWebsites(); render(); } catch (error) { setError(error); } };
    document.getElementById('index').onclick = async () => { try { await api('/websites/' + website.id + '/indexing-jobs', { method: 'POST' }); verification = 'Indexing job queued. Refresh status shortly.'; await loadWebsites(); render(); } catch (error) { setError(error); } };
    document.getElementById('assistant').onsubmit = async (event) => { event.preventDefault(); try { await saveAssistant(event.currentTarget); verification = 'Assistant saved.'; } catch (error) { setError(error); } };
    document.getElementById('test-chat').onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget; const output = document.getElementById('test-result'); output.textContent = 'Thinking…'; try { const values = Object.fromEntries(new FormData(form)); const result = await api('/websites/' + website.id + '/test-chat', { method: 'POST', body: JSON.stringify(values) }); output.textContent = result.answer || 'No answer returned.'; } catch (error) { output.textContent = error instanceof Error ? error.message : 'Test failed.'; } };
  }
  render();
})();`;
