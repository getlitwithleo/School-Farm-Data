# School Farm

Field, crop, input, scouting, rainfall and yield records for the school farm, in a single page (`index.html`). The Hybrid Trials tab compares dealer seed entries strip by strip (dry yield at standard moisture, results against check strips, averages by dealer), and each field card lists that field's trials. Open it in any browser, or turn on GitHub Pages for this repo to get a link.

Data you enter is saved in your browser. Use **Data & export** to download CSV files or a JSON backup.

Automatic daily rainfall (from the Waukesha County Airport weather station) only works in the hosted Claude version of the page; the copy here works the same otherwise, with rain logged by hand.

## Automatic updates

- **Crop sell prices** follow the futures market. A GitHub Action (`.github/workflows/update-prices.yml`) runs each weekday after the grain markets close, saves nearby CBOT and ICE futures prices to `prices.json`, and the page sets each crop's sell price to futures plus the basis you enter for that crop (Fields → Crops & sell prices). Sorghum follows corn futures. To refresh prices right away, open the Actions tab, choose **Update market prices**, then **Run workflow**. A field keeps the sale price you enter when you record its harvest.
- **Weather forecast**: the dashboard shows the National Weather Service 7-day forecast for the farm and checks for a new one every hour. Set the farm's location under **Data & export**.

## Shared records

Every device that opens the site sees the same records. `src/worker.js` keeps one shared copy in a Cloudflare Durable Object (set up in `wrangler.jsonc`) and serves the page and its files.

- Anyone with the link can view. Adding or changing records needs the farm passcode, entered once per device under **Data & export → Sharing** (or when you first tap an edit button). Capital letters don't matter.
- The farm manager sets the passcode once from the site (**Data & export → Sharing**), then chooses **Start the shared farm**. It is stored salted and hashed in the Worker's private storage, never in this repo, and can be changed from the same place. A `FARM_PASSCODE` secret in the Cloudflare dashboard (Workers & Pages → school-farm-data → Settings → Variables and Secrets) takes priority if set.
- After 10 wrong passcodes, a connection waits 15 minutes before it can try again.
- If two people save at once, their changes are merged record by record.
- The last 30 saved versions are kept. Download one under **Data & export → Sharing → Saved versions**, then use **Import JSON** to go back to it.
- Each browser also keeps its own copy, so the site works without a connection and catches up when it reconnects.
