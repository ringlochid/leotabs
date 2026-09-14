# Import OneTab, Toby or browser bookmarks into LeoTabs

Move saved tabs into LeoTabs collections using a local export file. LeoTabs accepts OneTab text, supported Toby collections/cards JSON, bookmark HTML and Markdown links. You can also import bookmarks directly from the Chrome or Edge profile where LeoTabs is installed.

Keep the original export and installation until you have checked the new collections. An import adds copies; it does not remove your data from the source app. You do not need an AI connection to import.

## Choose the right format

| Source | Input for LeoTabs | What to check |
| --- | --- | --- |
| OneTab | Text with one URL or URL-and-title entry per line | Links and titles; organize the imported list into groups afterward |
| Toby | Supported collections/cards JSON | Collection names and saved links; do not assume every Toby field or historical format transfers |
| Chrome or Edge bookmarks | Import browser bookmarks, or bookmark HTML | Imported collection structure and skipped URLs |
| Another bookmark tool | Bookmark HTML or Markdown links | Standard web links and the structure shown in the preview |

## Import from OneTab

1. Open OneTab's import/export view and copy the exported list of links. See the [official OneTab help](https://www.one-tab.com/help) for its export controls.
2. Save the list in a plain-text file. Keep entries on separate lines; OneTab's `URL | title` entries are supported.
3. Open **LeoTabs → Settings → Export & import → Import data**.
4. Expand **Import from a file**, choose **Choose file**, and select your text file.
5. Review the preview, then choose **Import collections**. Check several links before changing your original OneTab data.

For example, a text file can contain these harmless sample entries:

```text
https://example.com/ | Example home
https://example.org/ | Example reference
```

LeoTabs reads the URLs and titles as saved links. OneTab text does not carry a full browser session or LeoTabs groups and notes. Use [collection groups and notes](library.md) to organize the imported list once you have checked it.

## Import from Toby

1. Export the collections you want from Toby as JSON. Toby's [official export guide](https://help.gettoby.com/support/solutions/articles/66000508502-how-to-export-your-collections) explains its collection and account export options.
2. In LeoTabs, open **Settings → Export & import → Import data → Import from a file**.
3. Choose the JSON file and inspect the collection and link counts in the preview.
4. Choose **Import collections**, then compare collection names and a sample of links with Toby.

LeoTabs supports Toby exports containing collections with cards. An arbitrary JSON file, every historical Toby format, tags, sharing permissions and account settings are not guaranteed to transfer. If your JSON is rejected, keep it unchanged and try Toby's bookmark HTML export for the links. Review that preview too; different formats can preserve different amounts of structure.

## Import browser bookmarks

Choose **Import browser bookmarks** in LeoTabs's import dialog and grant bookmark access. Review the preview before adding the collections. For bookmarks from another browser or profile, export a bookmark HTML file there and import the file into LeoTabs.

These links become separate copies in LeoTabs. Editing a collection does not continuously synchronize the browser's original bookmark tree. The [bookmark import and export guide](import-export.md) explains how to export the links again.

## Check the transfer

Compare the preview with the source, inspect the imported collections, and open several links from different collections. Unsupported URLs and local-file links can be skipped; see the reported items instead of assuming every source entry was accepted.

Files must be no larger than 20 MB. An import that would put the library over 2,000 collections or 50,000 saved links is rejected. If an export is too large, export smaller selections in the source app; do not cut a JSON file in the middle.

Importing the same file again can create duplicates. Before retrying a transfer, inspect what is already in LeoTabs. Once satisfied, make a **Settings → Export & import → Backup JSON** copy of your LeoTabs library.

## What an import does not preserve

Saved links are not a complete browser session: unsaved form input, logged-in sessions and page application state are not transferred. API keys, other tools' accounts and collaboration settings are not imported. LeoTabs stores collections in the current browser profile and does not automatically synchronize them across devices.

After importing, [save and reopen a project](saving-switching.md), [organize your collections](library.md), or [export saved links to Notion](notion.md).
