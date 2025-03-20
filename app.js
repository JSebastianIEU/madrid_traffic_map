// Configuration
const CONFIG = {
    BASE_URL: 'https://raw.githubusercontent.com/JSebastianIEU/madrid_traffic_map/main/',
    MAX_ZOOM: 20,
    INITIAL_ZOOM: 14,
    ICON_SIZE: [28, 28],
    BATCH_SIZE: 500
};

// State
let map;
let markersCluster;
let activeFilters = {
    categories: new Set(),
    districts: new Set(),
    neighborhoods: new Set()
};

// Map Initialization
function initMap() {
    map = L.map('map', {
        maxZoom: CONFIG.MAX_ZOOM,
        minZoom: 10
    }).setView([40.4168, -3.7038], CONFIG.INITIAL_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    markersCluster = L.markerClusterGroup({
        chunkedLoading: true,
        chunkInterval: 100
    });
    map.addLayer(markersCluster);
}

// Optimized Data Loading
async function loadData() {
    try {
        const datasets = [
            {
                name: 'Traffic Lights',
                file: 'trafic.csv',
                coordColumns: ['Longitude', 'Latitude']
            },
            {
                name: 'Streetlights',
                file: 'lamps.csv',
                coordColumns: ['Longitude', 'Latitude'] // Original CSV has Latitude,Longitude but we'll fix
            },
            {
                name: 'Acoustic Signals',
                file: 'acustic.csv',
                coordColumns: ['Longitude', 'Latitude']
            }
        ];

        let allData = [];
        
        for (const dataset of datasets) {
            const url = `${CONFIG.BASE_URL}${dataset.file}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to load ${dataset.file}`);
            
            const csvData = await response.text();
            const results = Papa.parse(csvData, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true
            });

            const features = [];
            for (const row of results.data) {
                // Handle coordinate columns based on dataset
                let lng, lat;
                if (dataset.file === 'lamps.csv') {
                    // Special case for lamps.csv column order
                    lng = parseFloat(row.Longitude);
                    lat = parseFloat(row.Latitude);
                } else {
                    lng = parseFloat(row.Longitude);
                    lat = parseFloat(row.Latitude);
                }

                if (isNaN(lng)) lng = row.Longitude ? parseFloat(row.Longitude.replace(',', '.')) : null;
                if (isNaN(lat)) lat = row.Latitude ? parseFloat(row.Latitude.replace(',', '.')) : null;

                if (!lng || !lat) {
                    console.warn('Invalid coordinates in row:', row);
                    continue;
                }

                const properties = {
                    category: dataset.name,
                    district: row.district || 'Unknown',
                    neighborhood: dataset.name === 'Streetlights' ? row.neighborhood : 'N/A',
                    type: row.type || 'N/A',
                    id: row.id || 'N/A',
                    address: dataset.name === 'Streetlights' ? row.address : 'N/A'
                };

                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat]
                    },
                    properties
                });
            }
            
            // Add features in batches
            for (let i = 0; i < features.length; i += CONFIG.BATCH_SIZE) {
                const batch = features.slice(i, i + CONFIG.BATCH_SIZE);
                allData = allData.concat(batch);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        loadMarkers(allData);
        initFilters(allData);
        updateStatistics();
    } catch (error) {
        showError(error.message);
        console.error('Error:', error);
    }
}
// Optimized loadMarkers
function loadMarkers(data) {
    markersCluster.clearLayers();
    
    const iconCache = {};
    let index = 0;
    
    const processBatch = () => {
        const batch = data.slice(index, index + CONFIG.BATCH_SIZE);
        
        const geoJsonLayer = L.geoJSON(batch, {
            pointToLayer: (feature, latlng) => {
                const category = feature.properties.category;
                if (!iconCache[category]) {
                    iconCache[category] = L.icon({
                        iconUrl: `${CONFIG.BASE_URL}icons/${category.toLowerCase().replace(' ', '-')}.png`,
                        iconSize: CONFIG.ICON_SIZE,
                        error: () => L.divIcon({
                            className: 'custom-marker',
                            html: '📍',
                            iconSize: [30, 30]
                        })
                    });
                }
                
                const marker = L.marker(latlng, { icon: iconCache[category] });
                marker.bindPopup(createPopupContent(feature.properties));
                return marker;
            }
        });
        
        markersCluster.addLayer(geoJsonLayer);
        index += CONFIG.BATCH_SIZE;
        
        if (index < data.length) {
            setTimeout(processBatch, 50);
        }
    };
    
    processBatch();
}


// Add debounce to filter handling
let filterTimeout;
function handleFilterChange() {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
        activeFilters.categories = new Set(
            Array.from(document.querySelectorAll('[data-category]:checked'))
                .map(cb => cb.dataset.category)
        );
        
        activeFilters.districts = new Set(
            Array.from(document.querySelectorAll('[data-district]:checked'))
                .map(cb => cb.dataset.district)
        );

        activeFilters.neighborhoods = new Set(
            Array.from(document.querySelectorAll('[data-neighborhood]:checked'))
                .map(cb => cb.dataset.neighborhood)
        );

        updateVisibility();
        updateStatistics();
    }, 100);
}

// Filter System
function initFilters(data) {
    console.log('Initializing filters with data:', data);
    
    // Collect unique values
    const categories = new Set(data.map(f => f.properties.category));
    const districts = new Set(data.map(f => f.properties.district));
    const neighborhoods = new Set(data.map(f => f.properties.neighborhood));

    console.log('Filter options:', { categories, districts, neighborhoods });

    // Create filters
    const createFilters = (containerId, values, type) => {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        values.forEach(value => {
            if (value && value !== 'Unknown') {
                container.appendChild(createCheckbox(value, type));
            }
        });
    };

    createFilters('category-filters', categories, 'category');
    createFilters('district-filters', districts, 'district');
    createFilters('neighborhood-filters', neighborhoods, 'neighborhood');

    // Set initial active filters
    activeFilters.categories = new Set(categories);
    activeFilters.districts = new Set(districts);
    activeFilters.neighborhoods = new Set(neighborhoods);

    console.log('Active filters initialized:', activeFilters);
}

function createCheckbox(value, type) {
    const container = document.createElement('div');
    container.className = 'filter-item';
    
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset[type] = value;
    
    label.appendChild(input);
    label.appendChild(document.createTextNode(value));
    container.appendChild(label);
    
    return container;
}

// Filter Handlers
function handleFilterChange() {
    activeFilters.categories = new Set(
        Array.from(document.querySelectorAll('[data-category]:checked'))
            .map(cb => cb.dataset.category)
    );
    
    activeFilters.districts = new Set(
        Array.from(document.querySelectorAll('[data-district]:checked'))
            .map(cb => cb.dataset.district)
    );

    activeFilters.neighborhoods = new Set(
        Array.from(document.querySelectorAll('[data-neighborhood]:checked'))
            .map(cb => cb.dataset.neighborhood)
    );

    updateVisibility();
    updateStatistics();
}

// Modify updateVisibility to use requestAnimationFrame
function updateVisibility() {
    let layers = [];
    markersCluster.eachLayer(layer => layers.push(layer));
    
    let index = 0;
    
    function processLayer() {
        for(let i = 0; i < 100; i++) {
            if(index >= layers.length) return;
            
            const layer = layers[index];
            const props = layer.feature.properties;
            const visible = activeFilters.categories.has(props.category) &&
                          activeFilters.districts.has(props.district) &&
                          activeFilters.neighborhoods.has(props.neighborhood);
            
            layer.setOpacity(visible ? 1 : 0);
            layer.setStyle({ fillOpacity: visible ? 1 : 0 });
            
            index++;
        }
        
        requestAnimationFrame(processLayer);
    }
    
    processLayer();
}

// Statistics System
function updateStatistics() {
    const counts = {
        total: 0,
        categories: new Map(),
        districts: new Map()
    };

    markersCluster.eachLayer(marker => {
        if (marker.options.opacity === 1) {
            const props = marker.feature.properties;
            counts.total++;
            counts.categories.set(props.category, (counts.categories.get(props.category) || 0) + 1);
            counts.districts.set(props.district, (counts.districts.get(props.district) || 0) + 1);
        }
    });

    updateStatsDisplay(counts);
}

function updateStatsDisplay(counts) {
    document.getElementById('total-count').textContent = `Total Items: ${counts.total}`;
    
    document.getElementById('category-counts').innerHTML = Array.from(counts.categories.entries())
        .map(([name, count]) => `
            <div class="stat-item">
                <span>${name}</span>
                <span>${count}</span>
            </div>
        `).join('');
    
    document.getElementById('district-counts').innerHTML = Array.from(counts.districts.entries())
        .map(([name, count]) => `
            <div class="stat-item">
                <span>${name}</span>
                <span>${count}</span>
            </div>
        `).join('');
}

// Helper Functions
function toggleControlPanel() {
    document.querySelector('.control-panel').classList.toggle('collapsed');
}

function createPopupContent(properties) {
    let content = `<h4>${properties.category}</h4>`;
    content += `<p><strong>District:</strong> ${properties.district}</p>`;
    
    switch(properties.category) {
        case 'Acoustic Signals':
            content += `<p><strong>Type:</strong> ${properties.type}</p>`;
            content += `<p><strong>ID:</strong> ${properties.id}</p>`;
            break;
        case 'Streetlights':
            content += `<p><strong>Type:</strong> ${properties.type}</p>`;
            content += `<p><strong>Neighborhood:</strong> ${properties.neighborhood}</p>`;
            content += `<p><strong>Address:</strong> ${properties.address}</p>`;
            break;
        case 'Traffic Lights':
            content += `<p><strong>ID:</strong> ${properties.id}</p>`;
            break;
    }
    
    return content;
}

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    setTimeout(() => errorDiv.remove(), 5000);
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadData();
});