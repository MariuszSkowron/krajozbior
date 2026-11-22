"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

import { TILES_ATTRIBUTION, TILES_URL } from "@/lib/map-tiles";

import type { PinPosition } from "./place-coordinates";
import styles from "./place-map.module.css";

const MAX_ZOOM = 18;
const PLACE_ZOOM = 16;
const POLAND: L.LatLngBoundsLiteral = [
  [49, 14.1],
  [54.9, 24.2],
];
const PIN_SIZE = 32;

export const MAP_INSTRUCTION =
  "Kliknij na mapie albo przesuń mapę strzałkami i użyj przycisku „Ustaw pinezkę na środku mapy”.";

type PlaceMapProps = Readonly<{
  position: PinPosition | null;
  radiusM: number | null;
  /** Coordinates of the places the collection already has (the first view of a new place). */
  bounds: readonly PinPosition[];
  onPick: (position: PinPosition) => void;
  onTilesFailed: () => void;
  onHide: () => void;
}>;

function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: styles.pinWrap,
    html: `<span class="${styles.pin}" aria-hidden="true"></span>`,
    iconSize: [PIN_SIZE, PIN_SIZE],
    iconAnchor: [PIN_SIZE / 2, PIN_SIZE / 2],
  });
}

const toPosition = (latlng: L.LatLng): PinPosition => {
  const wrapped = latlng.wrap();

  return { latitude: wrapped.lat, longitude: wrapped.lng };
};

// The map of the place editor: plain Leaflet on one DOM element (no react-leaflet), like the map
// of a collection, loaded only after the curator picks "Pokaż mapę" (place-map-loader.tsx). The
// form fields stay the one source of data: the map only sets them (onPick) and reads the position.
export default function PlaceMap({
  position,
  radiusM,
  bounds,
  onPick,
  onTilesFailed,
  onHide,
}: PlaceMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pin = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  // Latest props for the handlers made once in the effect.
  const latest = useRef({ position, bounds, onPick, onTilesFailed });

  useEffect(() => {
    latest.current = { position, bounds, onPick, onTilesFailed };
  });

  useEffect(() => {
    const element = container.current;

    if (element === null) {
      return;
    }

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const instance = L.map(element, {
      zoomControl: false,
      attributionControl: false,
      maxZoom: MAX_ZOOM,
      zoomAnimation: !calm,
      fadeAnimation: !calm,
      markerZoomAnimation: !calm,
    });
    const start = latest.current;

    L.control.zoom({ zoomInTitle: "Przybliż", zoomOutTitle: "Oddal" }).addTo(instance);
    L.control.attribution({ prefix: false }).addTo(instance);

    const tiles = L.tileLayer(TILES_URL, { attribution: TILES_ATTRIBUTION, maxZoom: 19 });
    let reported = false;

    tiles.on("tileerror", () => {
      if (!reported) {
        reported = true;
        latest.current.onTilesFailed();
      }
    });
    tiles.addTo(instance);

    if (start.position !== null) {
      instance.setView([start.position.latitude, start.position.longitude], PLACE_ZOOM);
    } else if (start.bounds.length > 0) {
      instance.fitBounds(L.latLngBounds(start.bounds.map((p) => [p.latitude, p.longitude])), {
        maxZoom: 15,
        padding: [PIN_SIZE, PIN_SIZE],
      });
    } else {
      instance.fitBounds(POLAND);
    }

    instance.on("click", (event: L.LeafletMouseEvent) => {
      latest.current.onPick(toPosition(event.latlng));
    });

    map.current = instance;
    // The focus follows what appeared (WCAG 2.4.3): the keyboard user lands on the map.
    element.focus();

    return () => {
      instance.remove();
      map.current = null;
      pin.current = null;
      circle.current = null;
    };
  }, []);

  // The pin and the circle follow the position (a click, a drag, a typed value in range).
  useEffect(() => {
    const instance = map.current;

    if (instance === null) {
      return;
    }

    if (position === null) {
      pin.current?.remove();
      circle.current?.remove();
      pin.current = null;
      circle.current = null;

      return;
    }

    const point = L.latLng(position.latitude, position.longitude);

    if (pin.current === null) {
      const marker = L.marker(point, {
        icon: pinIcon(),
        draggable: true,
        keyboard: false,
        title: "Pinezka miejsca",
      });

      marker.on("dragend", () => {
        latest.current.onPick(toPosition(marker.getLatLng()));
      });
      marker.addTo(instance);
      pin.current = marker;
    } else {
      pin.current.setLatLng(point);
    }

    if (radiusM !== null) {
      if (circle.current === null) {
        circle.current = L.circle(point, { radius: radiusM, className: styles.radius }).addTo(
          instance,
        );
      } else {
        circle.current.setLatLng(point).setRadius(radiusM);
      }
    } else {
      circle.current?.remove();
      circle.current = null;
    }

    if (!instance.getBounds().contains(point)) {
      instance.panTo(point);
    }
  }, [position, radiusM]);

  return (
    <div className={styles.wrap}>
      <p id="place-map-instruction" className={styles.instruction}>
        {MAP_INSTRUCTION}
      </p>
      <div className={styles.frame}>
        <div
          ref={container}
          className={styles.map}
          role="region"
          aria-label="Mapa: położenie miejsca"
          aria-describedby="place-map-instruction"
          data-testid="place-map"
        />
        <span className={styles.crosshair} aria-hidden="true" data-testid="place-map-crosshair" />
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className="button button--outline"
          onClick={() => {
            const instance = map.current;

            if (instance !== null) {
              onPick(toPosition(instance.getCenter()));
            }
          }}
        >
          Ustaw pinezkę na środku mapy
        </button>
        <button type="button" className="button button--outline" onClick={onHide}>
          Ukryj mapę
        </button>
      </div>
    </div>
  );
}
