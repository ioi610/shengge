/** A single neutral dark appearance matching YouTube's page background. */
export function applyAppearance(root:HTMLElement,documentTheme=false){
 root.dataset.theme='dark';
 if(documentTheme){
  document.documentElement.dataset.theme='dark';
  document.documentElement.style.colorScheme='dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content','#0f0f0f');
 }
}
