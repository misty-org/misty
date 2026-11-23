pub struct EchoReducer {
    weights: Vec<f32>,
    history: Vec<f32>,
    cursor: usize,
    step: f32,
    energy: f32,
}

impl EchoReducer {
    pub fn new(taps: usize) -> Self {
        assert!(taps > 0);
        Self {
            weights: vec![0.0; taps],
            history: vec![0.0; taps],
            cursor: 0,
            step: 0.5,
            energy: 0.0,
        }
    }

    pub fn process(&mut self, mic: &mut [i16], reference: &[i16]) {
        let taps = self.weights.len();
        for (index, sample) in mic.iter_mut().enumerate() {
            let incoming = reference.get(index).map_or(0.0, |r| *r as f32 / 32768.0);
            let outgoing = self.history[self.cursor];
            self.energy += incoming * incoming - outgoing * outgoing;
            self.energy = self.energy.max(0.0);
            self.history[self.cursor] = incoming;

            let mut estimate = 0.0;
            for tap in 0..taps {
                estimate += self.weights[tap] * self.history[(self.cursor + taps - tap) % taps];
            }
            let input = *sample as f32 / 32768.0;
            let error = input - estimate;
            let gain = self.step * error / (self.energy + 1e-6);
            if self.energy > 1e-6 {
                for tap in 0..taps {
                    self.weights[tap] += gain * self.history[(self.cursor + taps - tap) % taps];
                }
            }
            self.cursor = (self.cursor + 1) % taps;
            *sample = crate::resample::to_i16(error);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn noise(len: usize, mut seed: u32) -> Vec<i16> {
        (0..len)
            .map(|_| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                ((seed >> 16) as i16) / 4
            })
            .collect()
    }

    fn energy(samples: &[i16]) -> f64 {
        samples.iter().map(|s| (*s as f64).powi(2)).sum::<f64>() / samples.len() as f64
    }

    #[test]
    fn removes_a_delayed_attenuated_echo() {
        let reference = noise(32_000, 7);
        let mut mic: Vec<i16> = (0..reference.len())
            .map(|i| {
                if i >= 80 {
                    (reference[i - 80] as f32 * 0.4) as i16
                } else {
                    0
                }
            })
            .collect();
        let before = energy(&mic[24_000..]);
        let mut reducer = EchoReducer::new(128);
        for (mic, reference) in mic.chunks_mut(320).zip(reference.chunks(320)) {
            reducer.process(mic, reference);
        }
        let after = energy(&mic[24_000..]);
        assert!(
            after < before / 100.0,
            "echo only fell from {before} to {after}"
        );
    }

    #[test]
    fn leaves_the_mic_alone_without_a_reference() {
        let original = noise(1600, 3);
        let mut mic = original.clone();
        EchoReducer::new(64).process(&mut mic, &[]);
        let drift: i32 = mic
            .iter()
            .zip(&original)
            .map(|(a, b)| (*a as i32 - *b as i32).abs())
            .max()
            .unwrap();
        assert!(drift <= 1);
    }
}
