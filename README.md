# School Farm

Field, crop, input, sales, rainfall and yield records for the school farm, in a single page (`index.html`). The Hybrid Trials tab compares dealer seed entries strip by strip (dry yield at standard moisture, results against check strips, averages by dealer), and each field card lists that field's trials. Open it in any browser, or turn on GitHub Pages for this repo to get a link.

Data you enter is saved in your browser. Use **Data & export** to download CSV files or a JSON backup.

Automatic daily rainfall (from the Waukesha County Airport weather station) only works in the hosted Claude version of the page; the copy here works the same otherwise, with rain logged by hand.

## Automatic updates

- **Crop sell prices** follow the futures market. A GitHub Action (`.github/workflows/update-prices.yml`) runs each weekday after the grain markets close, saves nearby CBOT and ICE futures prices to `prices.json`, and the page sets each crop's sell price to futures plus the basis you enter for that crop (Fields → Crops & sell prices). Sorghum follows corn futures. To refresh prices right away, open the Actions tab, choose **Update market prices**, then **Run workflow**. A field keeps the sale price you enter when you record its harvest. To set a crop's sell price yourself, type it in the **Sell prices** card on Yield & Profit (or under Fields → Crops & sell prices): the crop switches to **Manual** and keeps your price until you tap **Market**.
- **Weather forecast**: the dashboard shows the National Weather Service 7-day forecast for the farm and checks for a new one every hour. Set the farm's location under **Data & export**.

## Shared records

Every device that opens the site sees the same records. `src/worker.js` keeps one shared copy in a Cloudflare Durable Object (set up in `wrangler.jsonc`) and serves the page and its files.

- Anyone with the link can view. Adding or changing records needs the farm passcode, entered once per device under **Data & export → Sharing** (or when you first tap an edit button). Capital letters don't matter.
- The farm manager sets the passcode once from the site (**Data & export → Sharing**), then chooses **Start the shared farm**. It is stored salted and hashed in the Worker's private storage, never in this repo, and can be changed from the same place. A `FARM_PASSCODE` secret in the Cloudflare dashboard (Workers & Pages → school-farm-data → Settings → Variables and Secrets) takes priority if set.
- After 30 wrong passcodes in 15 minutes, a connection waits 15 minutes before it can try again. The limit is high because everyone at school shares one internet connection.
- If two people save at once, their changes are merged record by record.
- The last 30 saved versions are kept. Download one under **Data & export → Sharing → Saved versions**, then use **Import JSON** to go back to it.
- Each browser also keeps its own copy, so the site works without a connection and catches up when it reconnects.

## Yield formulas

Each crop has a bushels-per-acre formula for hybrid trial strips. Edit it with **Edit formula** on the Hybrid Trials tab, or **Yield formula** under Fields → Crops & sell prices.

- Corn's standard formula is `harv. wt × 109.815 × (100 − M) ÷ row length ÷ row width ÷ # of rows`. 109.815 = 43,560 sq ft per acre × 12 in per ft ÷ (85 × 56), for 15% moisture and 56 lb per bushel. Soybeans, wheat, sorghum and oats get the matching number for their own moisture and pounds per bushel.
- Formulas can use harvest weight, M (moisture), row length, row width, # of rows, test weight, acres, numbers, + − × ÷, parentheses, and min, max, round and abs. They're read safely and never run as code.
- Saving a formula recalculates every trial's yields, ranks, comparisons with the check strips, dealer averages and $ per acre.

## Sales

The Sales tab records each sale or contract: date, crop and season, field (optional), buyer, type (cash, forward contract, hedge-to-arrive, basis contract, delayed price), amount, price received, the futures price that day, deductions (drying, shrink, trucking, checkoff), moisture, test weight, contract or ticket number, and whether it's been delivered.

- The futures price fills in automatically from `price-history.json`, a year of daily closes kept by the same weekday price job. Basis = price received − futures.
- Marketing by crop compares what was raised (harvested, or expected before harvest) with what's sold or contracted, and values the unsold grain at today's sell price.
- Yield & Profit uses what you were paid for the sold bushels and today's sell price for the rest. A sale price typed on a field's harvest still takes priority.
- Contracts not yet delivered show under Needs attention on the dashboard when they're due within two weeks.
- **Your prices** charts only the farm's own prices for a crop: the average prices per bushel you add, connected as a line, and your sales as dots, over the last 1, 3, 6 or 12 months or all time. A dashed line and the first box above the chart show the average of those prices. Also shown: your latest price, the change since your last price and over the range, and your high and low.
- **Minimize** shrinks the Your prices card to one line with your latest price and the + Add a price button. Each device remembers it.
- **+ Add a price** logs the average price per bushel (per ton for hay, per pound for cotton) on a date, or a target price. Targets show as lines across the chart, and the dashboard tells you when your sell price reaches one.
- The rainfall log is on the Fields tab.


## Field map

**Switched off for now while it's being worked on.** The tab is hidden from everyone. To see it, open the site with `?preview=map`, for example https://school-farm-data.getlitwithleo.workers.dev/?preview=map#map. To put it back for everyone, set `MAP_FOR_EVERYONE` to `true` in `index.html`. Field outlines that were drawn stay saved with the fields either way.

The Field Map tab shows the farm's fields on a satellite picture.

- **Search** above the map: as you type, a dropdown lists matching places (towns, roads, schools, lakes, addresses), nearest the map first. Press **Search** or Enter to list every match, then pick one and the map zooms into it and marks it with a dot. Arrow keys and Enter work too, and GPS coordinates like `43.11, -88.49` go straight there. **My location** moves the map to where your phone is. Each device remembers the last place it picked, so the map opens there until fields are drawn.
- **+ Map a field** (or **Draw it** next to a field) opens the picture, starting where the page map was looking. Find the farm by searching an address or road, by tapping **My location** while standing at the field, or by dragging and zooming. Then tap each corner of the field in order. Drag a corner to move it, tap a small dot on an edge to add a corner there, and use **Undo last corner** or **Start over** to fix mistakes.
- The page measures the outline in acres and offers to update the field's acres to match.
- Color the fields by **Crop**, **Yield** (harvested yield compared with the expected yield) or **Profit** per acre. Yield and profit use a blue-to-red scale with gray for about average, so the colors stand out from the crops in the picture.
- Tap a field for its crop, acres, yield and profit, with buttons to edit the field or its shape. The Season, Crop and Field filters fade out the fields that don't match.
- Outlines are saved with the field and shared like every other record, so editing them needs the farm passcode.
- Satellite imagery is from Esri, the street map is from OpenStreetMap, place search uses Photon (with OpenStreetMap's Nominatim as a backup), and the map itself is drawn with Leaflet. They load only when the Field Map page or a map dialog opens.
