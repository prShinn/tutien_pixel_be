package com.tutien.pixel.controllers;

import com.tutien.pixel.entities.dtos.PortalDto;
import com.tutien.pixel.entities.portalEntity;
import com.tutien.pixel.services.PortalService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Optional;

@RestController
@RequestMapping("/api/portals")
@CrossOrigin("*") // Để Angular gọi được API mà không bị lỗi CORS
public class PortalController {

    @Autowired
    private PortalService portalService;

    @GetMapping
    public List<portalEntity> getAll() {
        return portalService.findAll();
    }

    @GetMapping("/{id}")
    public ResponseEntity<portalEntity> getById(@PathVariable int id) {
        return portalService.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/by-code")
    public ResponseEntity<portalEntity> getByCode(@RequestParam String code) throws Exception {
        return portalService.findByCode(code).map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public portalEntity create(@RequestBody portalEntity portal) {
        return portalService.save(portal);
    }

    @PutMapping("/{id}")
    public ResponseEntity<portalEntity> update(@PathVariable int id, @RequestBody portalEntity portal) {
        return ResponseEntity.ok(portalService.update(id, portal));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable int id) {
        portalService.delete(id);
        return ResponseEntity.noContent().build();
    }
}
