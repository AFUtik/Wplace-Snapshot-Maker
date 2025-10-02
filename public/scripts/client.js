async function loadSettings() {
    try {
        const res = await fetch("/settings.json");
        if (!res.ok) {
            console.error("Failed to load settings.json, using defaults.");
            return {};
        }
        return await res.json();
    } catch (err) {
        console.error("Error loading settings.json:", err);
        return {};
    }
}

let SELECTION_TYPE = "rectangle";

async function initMap() {
    const settings = await loadSettings();

    const map = L.map('leaflet-map', {
        maxBounds: [[180, -Infinity], [-180, Infinity]],
        maxBoundsViscosity: 1,
        minZoom: 1
    });

    const savedState = localStorage.getItem('mapState');
    if (savedState) {
        const state = JSON.parse(savedState);
        map.setView([state.lat, state.lng], state.zoom);
    } else {
        map.setView([0, 0], 0);
    }

    if (settings.load_topographic) {
        L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)',
            subdomains: 'abc',
            maxZoom: 17
        }).addTo(map);
    }

    L.tileLayer(`http://${settings.server_ip}:${settings.server_port}/tiles/{z}/{x}/{y}.png`, {
        tileSize: 512,
        maxNativeZoom: 12,
        maxZoom: 16,
        minZoom: settings.min_zoom,
        noWrap: true
    }).addTo(map);

    map.on('moveend zoomend', () => {
        const center = map.getCenter();
        localStorage.setItem('mapState', JSON.stringify({
            lat: center.lat,
            lng: center.lng,
            zoom: map.getZoom()
        }));
    });

    let markers = [];
    let polygon;

    map.on('contextmenu', function (e) {
        if(SELECTION_TYPE === "rectangle") {
            if (markers.length < 2) {
                const marker = L.marker(e.latlng).addTo(map);

                const tile_coords = map.project(e.latlng, 3);

                marker.bindTooltip(
                    `Tl x: ${Math.floor(tile_coords.x)}; Tl y: ${Math.floor(tile_coords.y)}`,
                    { permanent: true, direction: "top" }
                );

                markers.push(marker);
            } else {
                markers.forEach(m => map.removeLayer(m));
                markers = [];

                if(polygon) polygon.remove();

                fetch("/points/clear").then(res => res.json())
                    .then(data => console.log("Response:", data))
                    .catch(err => console.error("Error:", err));
            }

            if (markers.length == 2) {
                const px_coords0 = map.project(markers[0].getLatLng(), 3);
                const px_coords1 = map.project(markers[1].getLatLng(), 3);

                const x0 = Math.floor(Math.min(px_coords0.x, px_coords1.x));
                const y0 = Math.floor(Math.min(px_coords0.y, px_coords1.y));
                const x1 = Math.ceil(Math.max(px_coords0.x, px_coords1.x));
                const y1 = Math.ceil(Math.max(px_coords0.y, px_coords1.y));           

                const bounds = L.latLngBounds([map.unproject([x0, y0], 3), map.unproject([x1, y1], 3)]);
                polygon = L.rectangle(bounds, {
                    color: "blue", 
                    weight: 2,
                    fillColor: "blue", 
                    fillOpacity: 0.1
                    }).addTo(map);

                fetch('/points/rectangle', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        tileX0: Math.floor(px_coords0.x),
                        tileY0: Math.floor(px_coords0.y),
                        tileX1: Math.floor(px_coords1.x),
                        tileY1: Math.floor(px_coords1.y)
                    })
                }).then(res => res.json())
                    .then(data => console.log("Response:", data))
                    .catch(err => console.error("Error:", err));
            }
        } else if(SELECTION_TYPE === "polygon") {
            const marker = L.marker(e.latlng).addTo(map);

            markers.push(marker);

            if (polygon) polygon.remove();

            const latlngs = markers.map(m => m.getLatLng());

            polygon = L.polygon(latlngs, {
                color: "blue",
                weight: 2,
                fillColor: "blue",
                fillOpacity: 0.1
            }).addTo(map);

            const points = markers.map(marker => {
                const p = map.project(marker.getLatLng(), 3);
                return [p.x, p.y];
            });

            fetch('/points/polygon', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ points: points })
            }).then(res => res.json())
                    .then(data => console.log("Response:", data))
                    .catch(err => console.error("Error:", err));;
        }
    });

    return map;
}

let map;
initMap().then(m => map = m);

const btn = document.querySelector(".origin-btn");
btn.addEventListener("click", async () => {
    if (!map) return;

    try {
        const response = await fetch("/origin");
        const origin = await response.json();

        map.flyTo(map.unproject([origin.x, origin.y], 3), 14, { animate: true, duration: 2 });
    } catch (err) {
        console.error("Error while query:", err);
    }
});

async function updateList(select, query, firstEl="<option disabled selected>Select...</option>") {
  fetch(`/${query}`)
    .then(res => res.json())
    .then(data => {
      select.innerHTML = firstEl;

      data.items.forEach(item => {
        const option = document.createElement("option");
        option.text = item;
        select.appendChild(option);
      });
    })
    .catch(err => {
      console.error(err);
      select.innerHTML = "<option>Failed to load</option>";
    });
}

const sel_sel = document.getElementById("selectionSelect");
sel_sel.addEventListener("change", async () => {
  SELECTION_TYPE = sel_sel.options[sel_sel.selectedIndex].text.toLowerCase();
});

const date_sel = document.getElementById("dateSelect");

date_sel.addEventListener("mousedown", async () => {
   await updateList(date_sel, "dates") 
});
date_sel.addEventListener("change", async () => {
  const date = date_sel.value;
  try {
    const response = await fetch(`/loadByDate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: date })
    });
    const result = await response.json();
    console.log("Response:", result);
  } catch (err) {
    console.error("Error query:", err);
  }
});

const snapshot_sel = document.getElementById("snapshotSelect");
snapshot_sel.addEventListener("mousedown", async () => {
   await updateList(snapshot_sel, "snapshots") 
   await updateList(date_sel,     "dates") 
})
snapshot_sel.addEventListener("change", async () => {
  const text = snapshot_sel.value;
  try {
    const response = await fetch(`/loadByName/${text}`)
    const result = await response.json();
    console.log("Response:", result);
  } catch (err) {
    console.error("Error query:", err);
  }
});

const upd_btn = document.getElementById("updateBtn");
upd_btn.addEventListener("click", async () => {
    try {
        const response = await fetch(`/update`);
        const result =  await response.json();

        date_sel.options[0].value = result.date;
        await updateList(date_sel, "dates");
        console.log("Response:", result);
    } catch (err) {
       console.error("Error while query:", err); 
    }
});

const del_btn = document.getElementById("delBtn");
del_btn.addEventListener("click", async () => {
    try {
        const response = await fetch(`/delete`);
        const result =  await response.json();

        await updateList(date_sel, "dates");
        console.log("Response:", result);
    } catch (err) {
       console.error("Error while query:", err); 
    }
});

const crt_btn = document.getElementById("crtBtn");
const snapshot_input = document.getElementById("snapshotInput");
crt_btn.addEventListener("click", async () => {
    try {
        const response = await fetch(`/create/${snapshot_input.value}`);
        const result =  await response.json();

        console.log("Response:", result);
    } catch (err) {
       console.error("Error while query:", err); 
    }
});
