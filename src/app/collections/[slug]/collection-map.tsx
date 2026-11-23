"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";

import { TILES_ATTRIBUTION, TILES_URL } from "@/lib/map-tiles";

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

export type MapPoint = { latitude: number; longitude: number };

const MAX_ZOOM = 15;
const ICON_SIZE = 44;

function markerTitle(place: MapPlace): string {
  if (place.state === null) {
    return place.name;
  }

  return `${place.name} — ${place.state === "visited" ? "odwiedzone" : "do odkrycia"}`;
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
//
// `bounds` are the coordinates of ALL places of the collection: the view is fitted to them, never
// to the markers shown, so the filter "visited" cannot reveal through the tile numbers (which
// OpenStreetMap sees) which places the explorer visited (M1, privacy).
export default function CollectionMap({
  places,
  bounds,
}: {
  places: readonly MapPlace[];
  bounds: readonly MapPoint[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const hasStates = places.some((place) => place.state !== null);
  // The server sends new arrays on every render (router.refresh, navigation). The map is rebuilt
  // only when the content changes, so a refresh with the same data keeps the zoom and position.
  const signature = JSON.stringify({ places, bounds });

  useEffect(() => {
    const element = container.current;
    const data = JSON.parse(signature) as {
      places: MapPlace[];
      bounds: MapPoint[];
    };

    if (element === null || data.places.length === 0) {
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

    const tiles = L.tileLayer(TILES_URL, { attribution: TILES_ATTRIBUTION, maxZoom: 19 });
    let reported = false;

    // The notice appears once; the markers and the credit stay (the list is the full replacement).
    tiles.on("tileerror", () => {
      if (!reported) {
        reported = true;
        setTilesFailed(true);
      }
    });
    tiles.addTo(map);

    let opener: L.Marker | null = null;

    for (const place of data.places) {
      const marker = L.marker([place.latitude, place.longitude], {
        icon: markerIcon(place),
        keyboard: true,
        title: markerTitle(place),
        riseOnHover: true,
      });

      marker.bindPopup(popupContent(place), { closeButton: true });
      marker.on("popupopen", (event: L.PopupEvent) => {
        opener = marker;

        const popup = event.popup.getElement();
        const close = popup?.querySelector(".leaflet-popup-close-button");

        close?.setAttribute("aria-label", "Zamknij okienko");
        close?.setAttribute("title", "Zamknij okienko");
        // Focus follows what appeared (WCAG 2.4.3): the keyboard user lands on the link.
        popup?.querySelector<HTMLElement>("a[href^='/places/']")?.focus();
        // Leaflet reacts to Escape only while the map container itself has the focus; the focus
        // is now inside the popup, so close it from here.
        popup?.addEventListener("keydown", (key) => {
          if (key.key === "Escape") {
            map.closePopup();
          }
        });
      });
      marker.on("popupclose", (event: L.PopupEvent) => {
        // The focus was inside the popup (it fades out and leaves the DOM a moment later) or is
        // lost: give it back to the marker that opened the popup. A click elsewhere keeps its focus.
        const active = document.activeElement;
        const inPopup = active !== null && event.popup.getElement()?.contains(active) === true;

        if (opener === marker && (inPopup || active === document.body)) {
          marker.getElement()?.focus();
        }
      });
      marker.addTo(map);
    }

    const view = data.bounds.length > 0 ? data.bounds : data.places;

    map.fitBounds(L.latLngBounds(view.map((point) => [point.latitude, point.longitude])), {
      maxZoom: MAX_ZOOM,
      padding: [ICON_SIZE, ICON_SIZE],
    });

    return () => {
      map.remove();
    };
  }, [signature]);

  return (
    <div className={styles.wrap}>
      {tilesFailed ? (
        <p className={styles.notice} role="status">
          Mapa nie wczytała się w całości. Miejsca są na liście.
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
            Do odkrycia (numer miejsca)
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
