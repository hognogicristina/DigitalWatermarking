document.addEventListener('DOMContentLoaded', () => {
  const formInvisible = document.getElementById('watermark-form');
  const imageInput = document.getElementById('image-input');
  const originalPreview = document.getElementById('original-preview');
  const watermarkedImage = document.getElementById('watermarked-image');
  const mValueSpan = document.getElementById('m-value');
  const wValueSpan = document.getElementById('w-value');

  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        originalPreview.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  });

  formInvisible.addEventListener('submit', async (evt) => {
    evt.preventDefault();
    const file = imageInput.files[0];
    if (!file) {
      alert('Please select an image first.');
      return;
    }

    const keyValue = document.getElementById('key-input').value || '0';
    const modulusValue = document.getElementById('modulus-input').value || '256';

    const formData = new FormData();
    formData.append('image', file);
    formData.append('key', keyValue);
    formData.append('modulus', modulusValue);

    try {
      const response = await fetch('/watermark', {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        throw new Error('Server error');
      }
      const data = await response.json();
      mValueSpan.textContent = data.mValue;
      wValueSpan.textContent = data.wValue;
      watermarkedImage.src = `data:image/png;base64,${data.imageBase64}`;
    } catch (err) {
      console.error(err);
      alert('Error applying invisible watermark.');
    }
  });

  const encodeForm = document.getElementById('visible-watermark-form');
  const previewVisible = document.getElementById('visible-watermarked-preview');

  encodeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(encodeForm);

    try {
      const response = await fetch('/encode-visible', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (data.error) {
        alert(data.error);
      } else {
        previewVisible.src = `data:image/png;base64,${data.watermarked}`;
      }
    } catch (err) {
      console.error(err);
      alert('Error applying visible watermark.');
    }
  });

  const decodeForm = document.getElementById('decode-visible-form');
  const previewDecode = document.getElementById('decode-preview');

  decodeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(decodeForm);

    try {
      const response = await fetch('/decode-visible', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (data.error) {
        alert(data.error);
      } else {
        previewDecode.src = `data:image/png;base64,${data.original}`;
      }
    } catch (err) {
      console.error(err);
      alert('Error removing watermark.');
    }
  });
});
