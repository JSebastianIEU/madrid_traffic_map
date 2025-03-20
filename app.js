// Configuration
const CONFIG = {
    BASE_URL: 'https://raw.githubusercontent.com/JSebastianIEU/madrid_traffic_map/main/',
    MAX_ZOOM: 20,
    INITIAL_ZOOM: 14,
    ICON_SIZE: [28, 28]
};

// State
let map;
let markersCluster;
let activeFilters = {
    categories: new Set(),
    districts: new Set()
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

// Data Loading
async function loadData() {
    try {
        const datasets = {
            'Traffic Lights': 'trafic.csv',
            'Streetlights': 'lamps.csv',
            'Acoustic Signals': 'acustic.csv'
        };

        const allData = [];
        
        for (const [category, file] of Object.entries(datasets)) {
            const response = await fetch(`${CONFIG.BASE_URL}${file}`);
            const csvData = await response.text();
            
            const results = Papa.parse(csvData, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true
            });
            
            const features = results.data.map(row => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [row.Longitude, row.Latitude]
                },
                properties: {
                    category: category,
                    district: row.district || 'Unknown',
                    type: row.type || 'N/A',
                    installation_date: row.installation_date || 'Unknown'
                }
            }));
            
            allData.push(...features);
        }

        loadMarkers(allData);
        initFilters(allData);
        updateStatistics();
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Markers Management
function loadMarkers(data) {
    L.geoJSON(data, {
        pointToLayer: (feature, latlng) => {
            const icon = L.icon({
                iconUrl: `${CONFIG.BASE_URL}icons/${feature.properties.category.toLowerCase().replace(' ', '-')}.png`,
                iconSize: CONFIG.ICON_SIZE
            });

            const marker = L.marker(latlng, { icon });
            marker.bindPopup(createPopupContent(feature.properties));
            return marker;
        }
    }).addTo(markersCluster);
}

// Filter System
function initFilters(data) {
    const categories = new Set(['Traffic Lights', 'Streetlights', 'Acoustic Signals']);
    const districts = new Set(data.map(f => f.properties.district));

    // Create category filters
    const categoryContainer = document.getElementById('category-filters');
    categories.forEach(category => {
        categoryContainer.appendChild(createCheckbox(category, 'category'));
    });

    // Create district filters
    const districtContainer = document.getElementById('district-filters');
    districts.forEach(district => {
        districtContainer.appendChild(createCheckbox(district, 'district'));
    });

    // Set initial active filters
    activeFilters.categories = new Set(categories);
    activeFilters.districts = new Set(districts);

    // Add event listeners
    document.querySelectorAll('.filter-item input').forEach(checkbox => {
        checkbox.addEventListener('change', handleFilterChange);
    });
}

function createCheckbox(value, type) {
    const container = document.createElement('div');
    container.className = 'filter-item';
    
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset[type] = value;
    
    if(type === 'district') {
        const colorSpan = document.createElement('span');
        colorSpan.className = 'district-color';
        label.appendChild(colorSpan);
    }
    
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

    updateVisibility();
    updateStatistics();
}

function updateVisibility() {
    markersCluster.eachLayer(marker => {
        const props = marker.feature.properties;
        const visible = activeFilters.categories.has(props.category) &&
                      activeFilters.districts.has(props.district);
        
        marker.setOpacity(visible ? 1 : 0);
        marker.setStyle(visible ? {fillOpacity: 1} : {fillOpacity: 0});
    });
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
                <span class="district-color"></span>
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
    return `
        <div class="popup-content">
            <h4>${properties.category}</h4>
            <p><strong>District:</strong> ${properties.district}</p>
            ${properties.type ? `<p><strong>Type:</strong> ${properties.type}</p>` : ''}
            ${properties.installation_date ? `<p><strong>Installed:</strong> ${properties.installation_date}</p>` : ''}
        </div>
    `;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadData();
});