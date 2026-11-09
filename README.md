# School Farm

Field, crop, input, scouting, rainfall and yield records for the school farm, in a single page (`index.html`). The Hybrid Trials tab compares dealer seed entries strip by strip (dry yield at standard moisture, results against check strips, averages by dealer), and each field card lists that field's trials. Open it in any browser, or turn on GitHub Pages for this repo to get a link.

Data you enter is saved in your browser. Use **Data & export** to download CSV files or a JSON backup.

Automatic daily rainfall (from the Waukesha County Airport weather station) only works in the hosted Claude version of the page; the copy here works the same otherwise, with rain logged by hand.

## Automatic updates

- **Crop sell prices** follow the futures market. A GitHub Action (`.github/workflows/update-prices.yml`) runs each weekday after the grain markets close, saves nearby CBOT and ICE futures prices to `prices.json`, and the page sets each crop's sell price to futures plus the basis you enter for that crop (Fields → Crops & sell prices). Sorghum follows corn futures. To refresh prices right away, open the Actions tab, choose **Update market prices**, then **Run workflow**. A field keeps the sale price you enter when you record its harvest.
- **Weather forecast**: the dashboard shows the National Weather Service 7-day forecast for the farm and checks for a new one every hour. Set the farm's location under **Data & export**.
