"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";

import styles from "./collection-map.module.css";

export type MapPlace = {
  id: string;
  name: string;
  address: string;
  position: number;
  latitude: number;
  longitude: number;
  /** The explorer's state of the place; `null` for a guest (no visits to show). */
  state: "visited" | "unvisited" | null;
};

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
// The credit required by the tile policy (D-35); the link points to the OSM copyright page.
const ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>';
const MAX_ZOOM = 15;
const ICON_SIZE = 44;

function markerTitle(place: MapPlace): string {
  if (place.state === null) {
    return place.name;
  }

  return `${place.name} — ${place.state === "visited" ? "odwiedzone" : "do odwiedzenia"}`;
}

// A marker: a circle with the number (to visit) or a rounded square with a check mark (visited).
// The html holds only a number and a fixed sign, never text of the catalog.
function markerIcon(place: MapPlace): L.DivIcon {
  const visited = place.state === "visited";

  return L.divIcon({
    className: styles.markerWrap,
    html: `<span class="${styles.marker} ${visited ? styles.markerVisited : ""}" aria-hidden="true">${
      visited ? "✓" : String(place.position)
    }</span>`,
    iconSize: [ICON_SIZE, ICON_SIZE],
    iconAnchor: [ICON_SIZE / 2, ICON_SIZE / 2],
    popupAnchor: [0, -ICON_SIZE / 2],
  });
}

// The popup is built from DOM nodes with `textContent`, so a name from the catalog is never HTML.
function popupContent(place: MapPlace): HTMLElement {
  const root = document.createElement("div");
  const name = document.createElement("p");
  const link = document.createElement("a");

  name.className = styles.popupName;
  name.textContent = place.name;
  root.append(name);

  if (place.address !== "") {
    const address = document.createElement("p");

    address.className = styles.popupAddress;
    address.textContent = place.address;
    root.append(address);
  }

  link.href = `/places/${place.id}`;
  link.textContent = "Otwórz miejsce";
  root.append(link);

  return root;
}

// The map of the places of a collection. Plain Leaflet on one DOM element (no react-leaflet):
// created in an effect and removed on cleanup, which is safe for the double mount of React 19
// in development. Loaded only when the explorer picks the map (collection-map-loader.tsx).
export default function CollectionMap({ places }: { places: readonly MapPlace[] }) {
  const container = useRef<HTMLDivElement>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const hasStates = places.some((place) => place.state !== null);

  useEffect(() => {
    const element = container.current;

    if (element === null || places.length === 0) {
      return;
    }

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const map = L.map(element, {
      zoomControl: false,
      attributionControl: false,
      maxZoom: MAX_ZOOM + 3,
      zoomAnimation: !calm,
      fadeAnimation: !calm,
      markerZoomAnimation: !calm,
    });

    L.control.zoom({ zoomInTitle: "Przybliż", zoomOutTitle: "Oddal" }).addTo(map);
    L.control.attribution({ prefix: false }).addTo(map);

    const tiles = L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 });
    let reported = false;

    // The notice appears once; the markers and the credit stay (the list is the full replacement).
    tiles.on("tileerror", () => {
      if (!reported) {
        reported = true;
        setTilesFailed(true);
      }
    });
    tiles.addTo(map);

    const points = places.map((place) => {
      const marker = L.marker([place.latitude, place.longitude], {
        icon: markerIcon(place),
        keyboard: true,
        title: markerTitle(place),
        riseOnHover: true,
      });

      marker.bindPopup(popupContent(place));
      marker.addTo(map);

      return marker.getLatLng();
    });

    map.fitBounds(L.latLngBounds(points), { maxZoom: MAX_ZOOM, padding: [ICON_SIZE, ICON_SIZE] });

    return () => {
      map.remove();
    };
  }, [places]);

  return (
    <div className={styles.wrap}>
      {tilesFailed ? (
        <p className={styles.notice} role="status">
          Podkład mapy chwilowo się nie wczytuje. Znaczniki i lista miejsc działają dalej.
        </p>
      ) : null}
      <div
        ref={container}
        className={styles.map}
        role="region"
        aria-label="Mapa miejsc kolekcji"
        data-testid="collection-map"
      />
      {hasStates ? (
        <p className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.legendMark} aria-hidden="true">
              1
            </span>
            Do odwiedzenia (numer miejsca)
          </span>
          <span className={styles.legendItem}>
            <span className={`${styles.legendMark} ${styles.legendMarkVisited}`} aria-hidden="true">
              ✓
            </span>
            Odwiedzone
          </span>
        </p>
      ) : null}
    </div>
  );
}
