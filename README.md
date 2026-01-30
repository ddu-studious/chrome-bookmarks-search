# Chrome Bookmarks Search Extension

A Chrome extension built with Manifest V3 that allows users to quickly search through their bookmarks.

## Features

- Real-time bookmark search
- Clean and modern user interface
- Click to open bookmarks in new tabs

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked" and select this extension directory

## Project Structure

```
chrome-bookmarks-search/
├── manifest.json        # Extension configuration
├── popup.html          # Popup interface
├── background.js       # Background service worker
├── css/
│   └── popup.css      # Styles for popup
├── js/
│   └── popup.js       # Popup functionality
└── icons/             # Extension icons (need to be added)
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Development

To modify the extension:
1. Make your changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes

## Permissions

This extension requires the following permissions:
- `bookmarks`: To search and access bookmarks
- `storage`: For storing extension settings (if needed)

## License

MIT License
