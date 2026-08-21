document.querySelectorAll('.seg').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.seg').forEach((b) => b.classList.remove('active'));
    button.classList.add('active');
  });
});

const elements = document.querySelectorAll('.nav-item');

elements.forEach((item) => {
  item.addEventListener('click', (event) => {
    event.preventDefault();
    elements.forEach((el) => el.classList.remove('active'));
    item.classList.add('active');
  });
});
