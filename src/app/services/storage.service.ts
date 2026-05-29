import { inject, Injectable, NgZone } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';

export interface TrailerPreset {
  id: string;
  name: string;
  length: number;
  width: number;
  height: number;
}

export interface CargoPreset {
  id: string;
  name: string;
  length: number;
  width: number;
  height: number;
  color: string;
  stackable: boolean;
}

@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly firestore = inject(Firestore);
  private readonly ngZone = inject(NgZone);

  /** Get all trailers for user (real-time stream) */
  getTrailers(uid: string): Observable<TrailerPreset[]> {
    return new Observable<TrailerPreset[]>((subscriber) => {
      const colRef = collection(this.firestore, `users/${uid}/trailers`);
      const unsubscribe = onSnapshot(
        colRef,
        (snapshot) => {
          const trailers: TrailerPreset[] = [];
          snapshot.forEach((docSnap) => {
            trailers.push({ id: docSnap.id, ...docSnap.data() } as TrailerPreset);
          });
          this.ngZone.run(() => subscriber.next(trailers));
        },
        (error) => {
          console.error('[Firestore] Trailers snapshot error:', error);
          this.ngZone.run(() => subscriber.error(error));
        }
      );
      return unsubscribe;
    });
  }

  /** Add or update trailer */
  async saveTrailer(uid: string, trailer: TrailerPreset): Promise<void> {
    const docRef = doc(this.firestore, `users/${uid}/trailers/${trailer.id}`);
    await setDoc(docRef, trailer);
  }

  /** Delete trailer */
  async deleteTrailer(uid: string, id: string): Promise<void> {
    const docRef = doc(this.firestore, `users/${uid}/trailers/${id}`);
    await deleteDoc(docRef);
  }

  /** Get all cargo types for user (real-time stream) */
  getCargoTypes(uid: string): Observable<CargoPreset[]> {
    return new Observable<CargoPreset[]>((subscriber) => {
      const colRef = collection(this.firestore, `users/${uid}/cargo`);
      const unsubscribe = onSnapshot(
        colRef,
        (snapshot) => {
          const cargo: CargoPreset[] = [];
          snapshot.forEach((docSnap) => {
            cargo.push({ id: docSnap.id, ...docSnap.data() } as CargoPreset);
          });
          this.ngZone.run(() => subscriber.next(cargo));
        },
        (error) => {
          console.error('[Firestore] Cargo snapshot error:', error);
          this.ngZone.run(() => subscriber.error(error));
        }
      );
      return unsubscribe;
    });
  }

  /** Add or update cargo type */
  async saveCargoType(uid: string, cargo: CargoPreset): Promise<void> {
    const docRef = doc(this.firestore, `users/${uid}/cargo/${cargo.id}`);
    await setDoc(docRef, cargo);
  }

  /** Delete cargo type */
  async deleteCargoType(uid: string, id: string): Promise<void> {
    const docRef = doc(this.firestore, `users/${uid}/cargo/${id}`);
    await deleteDoc(docRef);
  }
}
