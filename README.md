# Commonplace

A phone-friendly commonplace book: quotes from your reading, journal entries and walk notes in one searchable place, all tagged by theme. Searching "patience" brings up the quote, the journal entry and the walk where you thought about it.

## What it does

- **Three kinds of entries:** Quote (author, book, page), Journal (title and writing) and Walk (place, distance or time, thoughts).
- **Themes:** tag each entry with words like `patience` or `courage`. The Themes tab shows every tag as a bubble; tap one to see everything filed under it.
- **Search:** one box searches text, themes, authors, books and places, and highlights the matches.
- **Photos:** attach a picture of a book cover, an underlined page or a trail. On a phone, "Take photo" opens the camera. Photos are resized to about 1000 px and re-drawn, which keeps them small and removes hidden location data.
- **Backup:** download all entries and photos as one `.json` file, and restore from it on any device.

## Privacy and storage

- No AI service, no accounts, no secret keys and no server. The app is three static files.
- Entries and photos are stored in the browser (IndexedDB) on the device you use. They are **not** synced between devices and are **not** encrypted.
- Clearing the site's data in your browser settings deletes your entries, so download a backup regularly.
- The page loads its fonts from Google Fonts. No entry content is sent anywhere.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page structure |
| `style.css` | Colours, fonts and layout (from the moodboard) |
| `app.js` | Saving, searching, photos, themes and backup |

## How to test

1. Double-click `index.html` to open it in your browser.
2. The book starts empty. Tap the pink **+** button and add a quote, a journal entry and a walk. Give each the theme `patience`, and give at least one a photo.
3. Type `patience` in the search box: all three appear, with the matches highlighted.
4. Open **Themes** and tap a bubble. Open **Photos** and tap a picture.
5. Edit an entry, then delete one.
6. On **Backup**, download a backup, erase everything, then restore from the file.
7. To check the phone layout on a laptop, open your browser's developer tools and switch to a phone-sized view, or open the published site on your phone.

## Publishing on GitHub Pages

All links between the files are relative, so the app works at any address, such as `https://yourusername.github.io/common-path/`. Upload `index.html`, `style.css` and `app.js` to the repository and turn on Pages in its settings. The camera works there because GitHub Pages uses HTTPS.
