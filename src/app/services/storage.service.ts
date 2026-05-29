import { inject, Injectable } from '@angular/core';
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

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private firestore = inject(Firestore);

  // Get all trailers for user (real-time stream)
  getTrailers(uid: string): Observable<TrailerPreset[]> {
    console.log('[StorageService] getTrailers called for uid:', uid);
    return new Observable<TrailerPreset[]>((subscriber) => {
      const colRef = collection(this.firestore, `users/${uid}/trailers`);
      console.log('[StorageService] Subscribing to trailers collection:', `users/${uid}/trailers`);
      const unsubscribe = onSnapshot(
        colRef,
        (snapshot) => {
          const trailers: TrailerPreset[] = [];
          snapshot.forEach((docSnap) => {
            trailers.push({ id: docSnap.id, ...docSnap.data() } as TrailerPreset);
          });
          console.log('Firebase data fetched (trailers):', trailers);
          subscriber.next(trailers);
        },
        (error) => {
          console.error('[StorageService] Firestore trailers snapshot error:', error);
          subscriber.error(error);
        }
      );
      return unsubscribe;
    });
  }

  // Add or update trailer
  async saveTrailer(uid: string, trailer: TrailerPreset): Promise<void> {
    console.log('[StorageService] saveTrailer called. uid:', uid, 'trailer:', trailer);
    const docRef = doc(this.firestore, `users/${uid}/trailers/${trailer.id}`);
    await setDoc(docRef, trailer);
    console.log('[StorageService] Trailer saved successfully:', trailer.id);
  }

  // Delete trailer
  async deleteTrailer(uid: string, id: string): Promise<void> {
    console.log('[StorageService] deleteTrailer called. uid:', uid, 'id:', id);
    const docRef = doc(this.firestore, `users/${uid}/trailers/${id}`);
    await deleteDoc(docRef);
    console.log('[StorageService] Trailer deleted successfully:', id);
  }

  // Get all cargo types for user (real-time stream)
  getCargoTypes(uid: string): Observable<CargoPreset[]> {
    console.log('[StorageService] getCargoTypes called for uid:', uid);
    return new Observable<CargoPreset[]>((subscriber) => {
      const colRef = collection(this.firestore, `users/${uid}/cargo`);
      console.log('[StorageService] Subscribing to cargo collection:', `users/${uid}/cargo`);
      const unsubscribe = onSnapshot(
        colRef,
        (snapshot) => {
          const cargo: CargoPreset[] = [];
          snapshot.forEach((docSnap) => {
            cargo.push({ id: docSnap.id, ...docSnap.data() } as CargoPreset);
          });
          console.log('Firebase data fetched (cargo):', cargo);
          subscriber.next(cargo);
        },
        (error) => {
          console.error('[StorageService] Firestore cargo snapshot error:', error);
          subscriber.error(error);
        }
      );
      return unsubscribe;
    });
  }

  // Add or update cargo type
  async saveCargoType(uid: string, cargo: CargoPreset): Promise<void> {
    console.log('[StorageService] saveCargoType called. uid:', uid, 'cargo:', cargo);
    const docRef = doc(this.firestore, `users/${uid}/cargo/${cargo.id}`);
    await setDoc(docRef, cargo);
    console.log('[StorageService] Cargo saved successfully:', cargo.id);
  }

  // Delete cargo type
  async deleteCargoType(uid: string, id: string): Promise<void> {
    console.log('[StorageService] deleteCargoType called. uid:', uid, 'id:', id);
    const docRef = doc(this.firestore, `users/${uid}/cargo/${id}`);
    await deleteDoc(docRef);
    console.log('[StorageService] Cargo deleted successfully:', id);
  }
}
