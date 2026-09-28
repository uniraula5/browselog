const site = document.getElementById('page-site');
const title = document.getElementById('page-title');
const refresh = document.getElementById('refresh');

async function showCurrentPage() {
  refresh.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url) {
      site.textContent = 'Page details unavailable';
      title.textContent = 'Open a website, then reopen BrowseLog.';
      return;
    }

    const url = new URL(tab.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      site.textContent = 'Browser or local page';
      title.textContent = 'BrowseLog currently supports ordinary websites.';
      return;
    }

    // Show text only, so a page title cannot insert HTML into the popup.
    site.textContent = url.hostname;
    title.textContent = tab.title?.trim() || 'Untitled page';
  } catch {
    site.textContent = 'Could not read this tab';
    title.textContent = 'Try reopening BrowseLog from the browser toolbar.';
  } finally {
    refresh.disabled = false;
  }
}

refresh.addEventListener('click', showCurrentPage);
showCurrentPage();
