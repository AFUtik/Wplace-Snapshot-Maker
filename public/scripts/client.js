// Функция для загрузки JSON настроек
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

    L.tileLayer('http://127.0.0.1:3000/tiles/{z}/{x}/{y}.png', {
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

    map.on('contextmenu', function (e) {
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
        }

        if (markers.length == 2) {
            const px_coords0 = map.project(markers[0].getLatLng(), 3);
            const px_coords1 = map.project(markers[1].getLatLng(), 3);

            fetch('/points', {
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
    });
}

initMap();