"use strict";

(() => {
  const canvas = document.getElementById("scene-canvas");
  const connectButton = document.getElementById("connect-button");
  const apiKeyInput = document.getElementById("api-key");
  const tenantInput = document.getElementById("tenant-id");
  const taskInput = document.getElementById("task-id");
  const eventLog = document.getElementById("event-log");
  const eventLogList = document.getElementById("event-log-list");
  const statusPill = document.getElementById("status-pill");

  if (!canvas || !window.THREE) {
    return;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1115);

  const camera = new THREE.PerspectiveCamera(
    50,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 3.5, 7);
  camera.lookAt(0, 0.5, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(5, 8, 3);
  scene.add(keyLight);

  const floorGeometry = new THREE.PlaneGeometry(12, 12);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x1b212b });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.5;
  scene.add(floor);

  const agentMaterial = new THREE.MeshStandardMaterial({ color: 0x3c9cff });
  const agents = [-2, 0, 2].map((x, index) => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geometry, agentMaterial.clone());
    mesh.position.set(x, 0.1, 0);
    mesh.material.color.offsetHSL(index * 0.08, 0.1, 0.05);
    scene.add(mesh);
    return mesh;
  });

  const resizeRenderer = () => {
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;

    if (!width || !height) {
      return;
    }

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  window.addEventListener("resize", resizeRenderer);
  resizeRenderer();

  let rafId = null;
  const clock = new THREE.Clock();
  const animate = () => {
    rafId = requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    agents.forEach((agent, index) => {
      agent.rotation.y = t * 0.4 + index * 0.6;
      agent.position.y = 0.1 + Math.sin(t * 1.2 + index) * 0.05;
    });

    renderer.render(scene, camera);
  };

  animate();

  let socket = null;

  const appendEvent = (message, status) => {
    if (eventLogList) {
      const item = document.createElement("li");
      item.textContent = message;
      eventLogList.prepend(item);
    } else if (eventLog) {
      const item = document.createElement("li");
      item.textContent = message;
      eventLog.prepend(item);
    }

    if (statusPill && status) {
      statusPill.textContent = status;
      statusPill.classList.remove("success", "error", "warning", "neutral");
      const statusLower = status.toLowerCase();
      const statusClass =
        statusLower === "connected"
          ? "success"
          : statusLower === "error"
            ? "error"
            : statusLower === "closed"
              ? "warning"
              : "neutral";
      statusPill.classList.add(statusClass);
    }
  };

  const connectSocket = () => {
    if (!apiKeyInput || !taskInput) {
      return;
    }

    const apiKey = apiKeyInput.value.trim();
    const tenantId = tenantInput.value.trim();
    const taskId = taskInput.value.trim();
    if (!apiKey || !taskId) {
      appendEvent("Missing api_key or task_id", "error");
      return;
    }

    if (socket) {
      socket.close();
    }

    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const host = window.location.host;
    let url = `${scheme}://${host}/ws/events?api_key=${encodeURIComponent(apiKey)}&task_id=${encodeURIComponent(taskId)}`;
    if (tenantId) {
      url += `&tenant_id=${encodeURIComponent(tenantId)}`;
    }

    socket = new WebSocket(url);

    socket.addEventListener("open", () => {
      appendEvent("Connected to event stream", "connected");
    });

    socket.addEventListener("message", (event) => {
      let payload = event.data;
      let status = "event";

      try {
        const parsed = JSON.parse(event.data);
        status = parsed.status || parsed.state || status;
        payload = parsed.message || parsed.event || event.data;
      } catch (error) {
        status = "event";
      }

      appendEvent(String(payload), String(status));
    });

    socket.addEventListener("close", () => {
      appendEvent("Socket closed", "closed");
    });

    socket.addEventListener("error", () => {
      appendEvent("Socket error", "error");
    });
  };

  if (connectButton) {
    connectButton.addEventListener("click", connectSocket);
  }

  window.addEventListener("beforeunload", () => {
    if (socket) {
      socket.close();
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    renderer.dispose();
  });
})();
